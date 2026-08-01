#!/usr/bin/env bash
set -euo pipefail

FORK_REMOTE="fork"
CREATED_BRANCH=""
IGNORED_FILES=()
COMMITTED_FILES=()
LINT_CHANGED="no"
CREATED_COMMIT="no"
PUSH_REF=""

log() {
  printf '==> %s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

repo_root() {
  git rev-parse --show-toplevel
}

current_branch() {
  git branch --show-current
}

has_changes() {
  [[ -n "$(git status --porcelain -uall)" ]]
}

remember_staged_files() {
  local file existing committed_file
  while IFS= read -r file; do
    existing="no"
    for committed_file in "${COMMITTED_FILES[@]+"${COMMITTED_FILES[@]}"}"; do
      if [[ "$committed_file" == "$file" ]]; then
        existing="yes"
        break
      fi
    done
    [[ "$existing" == "yes" ]] || COMMITTED_FILES+=("$file")
  done < <(staged_file_list)
}

is_ignored_file() {
  local file="$1"

  case "$file" in
    .env | .env.* | */.env | */.env.* | credentials.* | */credentials.* | *.secret | *.key | *.pem | .DS_Store | */.DS_Store | *.log | node_modules/* | */node_modules/* | .claude/tmp/*)
      return 0
      ;;
  esac

  return 1
}

path_is_dirty() {
  local file="$1"
  [[ -n "$(git status --porcelain -uall -- "$file")" ]]
}

package_json_dirty() {
  path_is_dirty "package.json"
}

restore_spurious_package_lock() {
  if path_is_dirty "package-lock.json" && ! package_json_dirty; then
    log "Discarding package-lock.json because package.json is unchanged"
    git restore --staged package-lock.json 2>/dev/null || true
    if git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
      git restore package-lock.json 2>/dev/null || true
    else
      rm -f package-lock.json
    fi
    IGNORED_FILES+=("package-lock.json (spurious without package.json)")
  fi
}

git_status_paths() {
  local record xy path
  while IFS= read -r -d '' record; do
    xy="${record:0:2}"
    path="${record:3}"
    [[ -z "$path" ]] && continue

    printf '%s\0' "$path"

    case "$xy" in
      R* | C* | *R | *C)
        IFS= read -r -d '' _ || true
        ;;
    esac
  done < <(git status --porcelain=v1 -z -uall)
}

ignored_status_paths() {
  local record xy path paired_path
  while IFS= read -r -d '' record; do
    xy="${record:0:2}"
    path="${record:3}"
    paired_path=""
    [[ -z "$path" ]] && continue

    case "$xy" in
      R* | C* | *R | *C)
        IFS= read -r -d '' paired_path || true
        ;;
    esac

    if is_ignored_file "$path" && [[ -f "$path" ]]; then
      printf '%s\0' "$path"
    fi
    if [[ -n "$paired_path" ]] && is_ignored_file "$paired_path" && [[ -f "$paired_path" ]]; then
      printf '%s\0' "$paired_path"
    fi
  done < <(git status --porcelain=v1 -z -uall)
}

status_is_delete() {
  local xy="$1"
  [[ "$xy" == D* || "$xy" == " D" ]]
}

deleted_path_matches_ignored_file() {
  local deleted_path="$1" ignored_path
  shift

  git cat-file -e "HEAD:$deleted_path" 2>/dev/null || return 1
  for ignored_path in "$@"; do
    [[ -f "$ignored_path" ]] || continue
    if cmp -s <(git show "HEAD:$deleted_path") "$ignored_path"; then
      printf '%s\n' "$ignored_path"
      return 0
    fi
  done

  return 1
}

stage_relevant_changes() {
  restore_spurious_package_lock

  local ignored_paths=() ignored_path record xy path paired_path moved_target
  while IFS= read -r -d '' ignored_path; do
    ignored_paths+=("$ignored_path")
  done < <(ignored_status_paths)

  while IFS= read -r -d '' record; do
    xy="${record:0:2}"
    path="${record:3}"
    paired_path=""
    [[ -z "$path" ]] && continue

    case "$xy" in
      R* | C* | *R | *C)
        IFS= read -r -d '' paired_path || true
        ;;
    esac

    if status_is_delete "$xy" && ((${#ignored_paths[@]} > 0)); then
      if moved_target="$(deleted_path_matches_ignored_file "$path" "${ignored_paths[@]}")"; then
        IGNORED_FILES+=("$path (moved to ignored path $moved_target)")
        git restore --staged -- "$path" 2>/dev/null || true
        git restore -- "$path" 2>/dev/null || true
        continue
      fi
    fi

    if is_ignored_file "$path" || { [[ -n "$paired_path" ]] && is_ignored_file "$paired_path"; }; then
      IGNORED_FILES+=("$path")
      [[ -z "$paired_path" ]] || IGNORED_FILES+=("$paired_path")
      git restore --staged -- "$path" 2>/dev/null || true
      [[ -z "$paired_path" ]] || git restore --staged -- "$paired_path" 2>/dev/null || true
      continue
    fi

    git add -A -- "$path"
    [[ -z "$paired_path" ]] || git add -A -- "$paired_path"
  done < <(git status --porcelain=v1 -z -uall)
}

staged_file_list() {
  git diff --cached --name-only
}

default_branch_name() {
  local files joined
  files="$(git_status_paths | awk -v RS='\0' 'NR <= 5 { printf "%s ", $0 }')"

  case "$files" in
    *".claude/skills/pr-push"*) joined="update-pr-push-skill" ;;
    *".github/workflows"*) joined="update-workflows" ;;
    *"rules/"* | *"AGENTS.md"*) joined="update-agent-docs" ;;
    *"src/"*) joined="update-app-code" ;;
    *) joined="codex-pr-push" ;;
  esac

  printf '%s-%s' "$joined" "$(date +%Y%m%d%H%M%S)"
}

ensure_feature_branch() {
  local branch
  branch="$(current_branch)"

  [[ -n "$branch" ]] || die "Detached HEAD is not supported"

  if [[ "$branch" == "main" || "$branch" == "master" ]]; then
    CREATED_BRANCH="$(default_branch_name)"
    log "On $branch; creating feature branch $CREATED_BRANCH"
    git checkout -b "$CREATED_BRANCH"
  else
    log "Using existing feature branch $branch"
  fi
}

commit_message_from_staged_files() {
  if [[ -n "${PR_PUSH_COMMIT_MESSAGE:-}" ]]; then
    printf '%s\n' "$PR_PUSH_COMMIT_MESSAGE"
    return
  fi

  local files
  files="$(staged_file_list | tr '\n' ' ')"

  case "$files" in
    *".claude/skills/pr-push"*) printf 'chore: update pr push skill\n' ;;
    *"rules/"* | *"AGENTS.md"*) printf 'docs: record session learnings\n' ;;
    *".github/workflows"*) printf 'ci: update workflows\n' ;;
    *) printf 'chore: update project files\n' ;;
  esac
}

commit_if_needed() {
  if ! has_changes; then
    log "No uncommitted changes to commit"
    return
  fi

  stage_relevant_changes

  if [[ -z "$(staged_file_list)" ]]; then
    log "No relevant changes staged"
    return
  fi

  remember_staged_files
  local message
  message="$(commit_message_from_staged_files)"
  log "Committing staged changes: $message"
  git commit -m "$message"
  CREATED_COMMIT="yes"
}

run_checks() {
  log "Running formatter"
  npm run fmt || die "Formatter failed; fix the issues above and rerun"

  log "Running lint fix"
  npm run lint:fix || die "Lint failed; fix the issues above and rerun"

  log "Running typecheck"
  npm run ts || die "Typecheck failed; fix the issues above and rerun"
}

amend_or_commit_check_changes() {
  if ! has_changes; then
    log "Checks did not modify tracked files"
    return
  fi

  LINT_CHANGED="yes"
  stage_relevant_changes

  if [[ -z "$(staged_file_list)" ]]; then
    log "Checks only touched ignored files"
    return
  fi

  remember_staged_files
  if [[ "$CREATED_COMMIT" == "yes" ]]; then
    log "Amending automated check changes into previous commit"
    git commit --amend --no-edit
  else
    log "Committing automated check changes"
    git commit -m "chore: apply automated fixes"
    CREATED_COMMIT="yes"
  fi
}

is_permission_push_error() {
  grep -qiE 'permission|denied|403|not allowlisted|could not read Username' <<<"$1"
}

has_github_token_env() {
  [[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}${GH_ENTERPRISE_TOKEN:-}${GITHUB_ENTERPRISE_TOKEN:-}" ]]
}

git_push_with_token_retry() {
  local output_var="$1"
  shift
  local output retry_output

  if output="$("$@" 2>&1)"; then
    printf -v "$output_var" '%s' "$output"
    return 0
  fi

  if has_github_token_env && is_permission_push_error "$output"; then
    log "Push failed with permission-like error; retrying same remote without GitHub token environment variables"
    if retry_output="$(env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN "$@" 2>&1)"; then
      printf -v "$output_var" '%s' "$retry_output"
      return 0
    fi
    output="${output}"$'\n'"Retry without GitHub token environment variables also failed:"$'\n'"${retry_output}"
  fi

  printf -v "$output_var" '%s' "$output"
  return 1
}

push_to_fork() {
  local branch push_output
  branch="$(current_branch)"

  git remote get-url --push "$FORK_REMOTE" >/dev/null 2>&1 || die "Required remote '$FORK_REMOTE' is not configured"

  PUSH_REF="$FORK_REMOTE/$branch"
  log "Pushing current branch only to $PUSH_REF"
  if git_push_with_token_retry push_output git push --force-with-lease -u "$FORK_REMOTE" "HEAD:$branch"; then
    printf '%s\n' "$push_output"
    return
  fi

  printf '%s\n' "$push_output" >&2
  die "Push to $FORK_REMOTE failed; no other remote was attempted"
}

print_summary() {
  printf '\nFork push summary\n'
  printf -- '-----------------\n'
  printf 'Branch: %s\n' "$(current_branch)"
  [[ -n "$CREATED_BRANCH" ]] && printf 'Created branch: %s\n' "$CREATED_BRANCH"
  printf 'Committed files:\n'
  if ((${#COMMITTED_FILES[@]} == 0)); then
    printf -- '- none\n'
  else
    printf -- '- %s\n' "${COMMITTED_FILES[@]+"${COMMITTED_FILES[@]}"}"
  fi
  printf 'Ignored files:\n'
  if ((${#IGNORED_FILES[@]} == 0)); then
    printf -- '- none\n'
  else
    printf -- '- %s\n' "${IGNORED_FILES[@]+"${IGNORED_FILES[@]}"}"
  fi
  printf 'Automated check changes: %s\n' "$LINT_CHANGED"
  printf 'Checks: fmt, lint:fix, ts passed; unit tests not run by script\n'
  printf 'Pushed remote: %s\n' "$FORK_REMOTE"
  printf 'Pushed ref: %s\n' "$PUSH_REF"
  printf 'Pull request operations: disabled\n'
}

main() {
  cd "$(repo_root)"
  ensure_feature_branch
  commit_if_needed
  run_checks
  amend_or_commit_check_changes
  push_to_fork
  print_summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
