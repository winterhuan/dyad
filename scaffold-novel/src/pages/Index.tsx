import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  FileText,
  ListTree,
  Search,
  Users,
} from "lucide-react";

import project from "../../novel/project.md?raw";
import outline from "../../novel/outline.md?raw";
import characters from "../../novel/bible/characters.md?raw";

type WorkspaceView = "manuscript" | "outline" | "characters";

const views: Array<{
  id: WorkspaceView;
  label: string;
  icon: typeof FileText;
}> = [
  { id: "manuscript", label: "Manuscript", icon: FileText },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "characters", label: "Characters", icon: Users },
];

const chapterFiles = import.meta.glob("../../novel/chapters/*.md", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*[\s\S]*?\s*---\s*/, "").trim();
}

function countWords(markdown: string): number {
  const prose = stripFrontmatter(markdown).replace(/^#+\s+/gm, "");
  const cjkCharacters =
    prose.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    )?.length ?? 0;
  const latinWords =
    prose
      .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
      ?.filter(
        (word) =>
          !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
            word,
          ),
      ).length ?? 0;
  return cjkCharacters + latinWords;
}

function markdownTitle(markdown: string, fallback: string): string {
  return /^#\s+(.+)$/m.exec(stripFrontmatter(markdown))?.[1] ?? fallback;
}

function chapterStatus(markdown: string): string {
  const status = /^status:\s*(.+)$/m.exec(markdown)?.[1]?.trim() ?? "draft";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const chapters = Object.entries(chapterFiles)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([filePath, content], index) => ({
    id: filePath,
    content,
    number: String(index + 1).padStart(2, "0"),
    status: chapterStatus(content),
    title: markdownTitle(content, `Chapter ${index + 1}`),
  }));

const emptyManuscript =
  "# No chapters yet\n\nAsk the Agent to draft the first scene when the outline is ready.";

function MarkdownPage({ content }: { content: string }) {
  const lines = stripFrontmatter(content).split("\n");
  return (
    <div className="space-y-3 text-[15px] leading-7 text-[#31383d]">
      {lines.map((line, index) => {
        if (line.startsWith("# ")) {
          return (
            <h2
              key={index}
              className="pt-1 text-2xl font-semibold text-[#1e2529]"
            >
              {line.slice(2)}
            </h2>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h3
              key={index}
              className="pt-5 text-base font-semibold text-[#7f2636]"
            >
              {line.slice(3)}
            </h3>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <h4
              key={index}
              className="pt-3 text-sm font-semibold text-[#1e2529]"
            >
              {line.slice(4)}
            </h4>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <div key={index} className="flex gap-3 pl-1">
              <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[#a03d4e]" />
              <p>{line.slice(2)}</p>
            </div>
          );
        }
        return line ? (
          <p key={index}>{line}</p>
        ) : (
          <div key={index} className="h-1" />
        );
      })}
    </div>
  );
}

const Index = () => {
  const [activeView, setActiveView] = useState<WorkspaceView>("manuscript");
  const [activeChapterId, setActiveChapterId] = useState(chapters[0]?.id ?? "");
  const [chapterSearch, setChapterSearch] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const activeChapter =
    chapters.find(({ id }) => id === activeChapterId) ?? chapters[0];
  const visibleChapters = chapters.filter(({ title }) =>
    title
      .toLocaleLowerCase()
      .includes(chapterSearch.trim().toLocaleLowerCase()),
  );
  const activeDocument =
    activeView === "manuscript"
      ? (activeChapter?.content ?? emptyManuscript)
      : activeView === "outline"
        ? outline
        : characters;
  const wordCount = useMemo(() => countWords(activeDocument), [activeDocument]);

  return (
    <div className="min-h-screen bg-[#f4f6f7] text-[#20282d] lg:flex">
      <aside className="border-b border-[#dce1e4] bg-white lg:min-h-screen lg:w-[280px] lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center gap-3 border-b border-[#e6e9eb] px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#7f2636] text-white">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Manuscript</p>
            <p className="truncate text-xs text-[#6c777e]">Novel workspace</p>
          </div>
        </div>

        <nav
          className="grid grid-cols-3 gap-1 p-3 lg:block"
          aria-label="Workspace"
        >
          {views.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveView(id)}
              className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-md px-2 text-xs sm:text-sm lg:mb-1 lg:justify-start lg:gap-2 lg:px-3 ${
                activeView === id
                  ? "bg-[#f7e9ec] font-medium text-[#7f2636]"
                  : "text-[#59656c] hover:bg-[#f1f3f4] hover:text-[#20282d]"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>

        <div className="hidden px-4 pb-5 lg:block">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-[#7b858b]">
              Chapters
            </p>
            <button
              type="button"
              aria-label="Search chapters"
              title="Search chapters"
              aria-pressed={isSearching}
              onClick={() => setIsSearching((value) => !value)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#6c777e] hover:bg-[#f1f3f4]"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {isSearching && (
            <input
              type="search"
              value={chapterSearch}
              onChange={(event) => setChapterSearch(event.target.value)}
              placeholder="Find a chapter"
              aria-label="Find a chapter"
              className="mb-3 h-9 w-full rounded-md border border-[#ccd3d7] bg-white px-3 text-sm outline-none focus:border-[#7f2636]"
            />
          )}
          <div className="space-y-2">
            {visibleChapters.map((chapter) => (
              <button
                key={chapter.id}
                type="button"
                onClick={() => {
                  setActiveChapterId(chapter.id);
                  setActiveView("manuscript");
                }}
                className={`w-full rounded-md border p-3 text-left shadow-sm ${
                  activeChapter?.id === chapter.id
                    ? "border-[#d8dde0] bg-[#fafbfb]"
                    : "border-transparent bg-white hover:border-[#d8dde0]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-[#7f2636]">
                    {chapter.number}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-[#39715a]">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    {chapter.status}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium leading-5">
                  {chapter.title.replace(/^Chapter \d+:\s*/, "")}
                </p>
              </button>
            ))}
            {visibleChapters.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-[#7b858b]">
                No matching chapters
              </p>
            )}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="border-b border-[#dce1e4] bg-white px-5 py-4 sm:px-8">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-[#7f2636]">
                {activeView === "manuscript"
                  ? `Chapter ${activeChapter?.number ?? "--"}`
                  : "Story reference"}
              </p>
              <h1 className="truncate text-lg font-semibold sm:text-xl">
                {markdownTitle(activeDocument, "Untitled Novel")}
              </h1>
            </div>
            {activeView === "manuscript" && chapters.length > 1 && (
              <select
                value={activeChapter?.id}
                onChange={(event) => setActiveChapterId(event.target.value)}
                aria-label="Select chapter"
                className="h-9 max-w-48 rounded-md border border-[#ccd3d7] bg-white px-2 text-sm lg:hidden"
              >
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.number}. {chapter.title}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-3 text-xs text-[#667178]">
              <span>{wordCount.toLocaleString()} words</span>
              <span className="h-4 w-px bg-[#d8dde0]" />
              <span className="flex items-center gap-1.5 text-[#39715a]">
                <span className="h-2 w-2 rounded-full bg-[#4b8b6e]" />
                Saved
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-5xl gap-8 px-5 py-7 sm:px-8 xl:grid-cols-[minmax(0,1fr)_240px]">
          <article className="min-h-[620px] border border-[#dce1e4] bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-10">
            <MarkdownPage content={activeDocument} />
          </article>

          <aside className="hidden xl:block">
            <p className="mb-3 text-xs font-semibold uppercase text-[#7b858b]">
              Project
            </p>
            <div className="space-y-2">
              <div className="rounded-md border border-[#dce1e4] bg-white p-3">
                <p className="text-xs text-[#7b858b]">Working title</p>
                <p className="mt-1 text-sm font-medium">
                  {markdownTitle(project, "Untitled Novel")}
                </p>
              </div>
              <div className="rounded-md border border-[#dce1e4] bg-white p-3">
                <p className="text-xs text-[#7b858b]">Draft status</p>
                <p className="mt-1 text-sm font-medium">
                  {chapters.length} {chapters.length === 1 ? "scene" : "scenes"}
                </p>
              </div>
              <div className="rounded-md border border-[#dce1e4] bg-white p-3">
                <p className="text-xs text-[#7b858b]">Canon checks</p>
                <p className="mt-1 text-sm font-medium text-[#39715a]">
                  No conflicts
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default Index;
