import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "path";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "@/paths/paths";
import { stylesToTailwind, extractClassPrefixes } from "@/utils/style-utils";
import { gitAdd, gitCommit, gitResetFile } from "@/ipc/utils/git_utils";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
import {
  VALID_IMAGE_MIME_TYPES,
  type VisualEditingChange,
  visualEditingContracts,
} from "@/ipc/types/visual-editing";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import {
  transformContentWithResult,
  analyzeComponent,
} from "@/ipc/utils/visual_editing_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "@/ipc/handlers/base";
import { createAppMutationLock } from "@/ipc/utils/app_mutation_lock";

// Client allows 7.5 MB raw; base64 expands by ~4/3 plus data URL prefix
const MAX_IMAGE_SIZE = Math.ceil((7.5 * 1024 * 1024) / 3) * 4 + 100; // ~10,485,860

export function registerVisualEditingHandlers() {
  createTypedHandler(
    visualEditingContracts.applyChanges,
    createAppMutationLock(async (_event, params) => {
      const { appId, changes } = params;
      const writtenImagePaths: string[] = [];
      const stagedGitPaths: { appPath: string; filepath: string }[] = [];
      const commitFilepaths = new Set<string>();
      const originalFileContents: {
        filePath: string;
        content: string;
        existed: boolean;
      }[] = [];
      try {
        if (changes.length === 0) {
          return {
            modifiedFiles: [],
            commitHash: null,
            appliedCount: 0,
            skipped: [],
          };
        }

        // Get the app to find its path
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new DyadError(
            `App not found: ${appId}`,
            DyadErrorKind.NotFound,
          );
        }

        const appPath = getDyadAppPath(app.path);
        const hasGitRepo = fs.existsSync(path.join(appPath, ".git"));

        // Validate all image uploads upfront before making any changes
        const imageValidationErrors: string[] = [];
        for (const change of changes) {
          if (change.imageUpload) {
            const { fileName, base64Data, mimeType } = change.imageUpload;

            if (
              !(VALID_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
            ) {
              imageValidationErrors.push(
                `"${fileName}": Unsupported image type (${mimeType}). Allowed types: JPEG, PNG, GIF, WebP.`,
              );
            }

            if (base64Data.length > MAX_IMAGE_SIZE) {
              imageValidationErrors.push(
                `"${fileName}": The image is too large (max 7.5 MB). Please choose a smaller file.`,
              );
            }
          }
        }

        if (imageValidationErrors.length > 0) {
          throw new DyadError(
            imageValidationErrors.length === 1
              ? imageValidationErrors[0]
              : `Multiple image issues:\n${imageValidationErrors.join("\n")}`,
            DyadErrorKind.Validation,
          );
        }

        const preparedImages = new Map<
          VisualEditingChange,
          {
            buffer: Buffer;
            mediaPath: string;
            destPath: string;
            imageFilepath: string;
          }
        >();

        // Resolve upload paths before changing any files. The files are written
        // only after the corresponding source component is confirmed editable.
        for (const change of changes) {
          if (change.imageUpload) {
            const { fileName, base64Data } = change.imageUpload;

            const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
            const finalFileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizedFileName}`;

            const buffer = Buffer.from(
              base64Data.replace(/^data:[^;]+;base64,/, ""),
              "base64",
            );

            const mediaRelativePath = await assertMutationPathAllowed({
              appPath,
              relativePath: path.join(DYAD_MEDIA_DIR_NAME, finalFileName),
            });
            const mediaPath = safeJoin(appPath, mediaRelativePath);
            const imageFilepath = await assertMutationPathAllowed({
              appPath,
              relativePath: path.join("public", "images", finalFileName),
            });
            const destPath = safeJoin(appPath, imageFilepath);
            change.imageSrc = `/images/${finalFileName}`;
            preparedImages.set(change, {
              buffer,
              mediaPath,
              destPath,
              imageFilepath,
            });
          }
        }

        type Location = number | string;
        const fileChanges = new Map<
          string,
          {
            lineChanges: Map<
              Location,
              {
                classes: string[];
                prefixes: string[];
                textContent?: string;
                imageSrc?: string;
              }
            >;
            changesByLocation: Map<Location, VisualEditingChange[]>;
          }
        >();

        for (const change of changes) {
          const normalizedRelativePath = await assertMutationPathAllowed({
            appPath,
            relativePath: change.relativePath,
          });
          let groupedFile = fileChanges.get(normalizedRelativePath);
          if (!groupedFile) {
            groupedFile = {
              lineChanges: new Map<
                Location,
                {
                  classes: string[];
                  prefixes: string[];
                  textContent?: string;
                  imageSrc?: string;
                }
              >(),
              changesByLocation: new Map(),
            };
            fileChanges.set(normalizedRelativePath, groupedFile);
          }

          const location =
            change.columnNumber === undefined
              ? change.lineNumber
              : `${change.lineNumber}:${change.columnNumber}`;
          const tailwindClasses = stylesToTailwind(change.styles);
          groupedFile.lineChanges.set(location, {
            classes: tailwindClasses,
            prefixes: extractClassPrefixes(tailwindClasses),
            ...(change.textContent !== undefined && {
              textContent: change.textContent,
            }),
            ...(change.imageSrc !== undefined && {
              imageSrc: change.imageSrc,
            }),
          });
          const locationChanges =
            groupedFile.changesByLocation.get(location) ?? [];
          locationChanges.push(change);
          groupedFile.changesByLocation.set(location, locationChanges);
        }

        const appliedChanges = new Set<VisualEditingChange>();
        const skipped: { componentId: string; reason: string }[] = [];
        const sourceWrites: {
          relativePath: string;
          filePath: string;
          content: string;
          transformedContent: string;
        }[] = [];

        for (const [relativePath, groupedFile] of fileChanges) {
          const filePath = safeJoin(appPath, relativePath);
          const content = await fsPromises.readFile(filePath, "utf-8");
          const transformed = transformContentWithResult(
            content,
            groupedFile.lineChanges,
          );
          const fileChanged = transformed.content !== content;

          for (const [
            location,
            locationChanges,
          ] of groupedFile.changesByLocation) {
            const result = transformed.locations.get(location);
            if (result?.applied && fileChanged) {
              for (const change of locationChanges) appliedChanges.add(change);
              continue;
            }
            const reason =
              result?.reason ??
              "The requested changes did not modify the source file.";
            for (const change of locationChanges) {
              skipped.push({ componentId: change.componentId, reason });
            }
          }

          if (fileChanged) {
            sourceWrites.push({
              relativePath,
              filePath,
              content,
              transformedContent: transformed.content,
            });
          }
        }

        const modifiedFiles = new Set<string>();
        for (const sourceWrite of sourceWrites) {
          originalFileContents.push({
            filePath: sourceWrite.filePath,
            content: sourceWrite.content,
            existed: true,
          });
          await fsPromises.writeFile(
            sourceWrite.filePath,
            sourceWrite.transformedContent,
            "utf-8",
          );
          modifiedFiles.add(sourceWrite.relativePath);
          if (hasGitRepo) commitFilepaths.add(sourceWrite.relativePath);
        }

        const hasAppliedImageUpload = [...appliedChanges].some((change) =>
          preparedImages.has(change),
        );
        if (hasAppliedImageUpload) {
          const gitignorePath = path.join(appPath, ".gitignore");
          let originalGitignoreContent = "";
          let gitignoreExisted = true;
          try {
            originalGitignoreContent = await fsPromises.readFile(
              gitignorePath,
              "utf-8",
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            gitignoreExisted = false;
          }

          await ensureDyadGitignored(appPath);
          const updatedGitignoreContent = await fsPromises.readFile(
            gitignorePath,
            "utf-8",
          );
          if (
            !gitignoreExisted ||
            updatedGitignoreContent !== originalGitignoreContent
          ) {
            originalFileContents.push({
              filePath: gitignorePath,
              content: originalGitignoreContent,
              existed: gitignoreExisted,
            });
            modifiedFiles.add(".gitignore");
            if (hasGitRepo) {
              await gitAdd({ path: appPath, filepath: ".gitignore" });
              stagedGitPaths.push({ appPath, filepath: ".gitignore" });
              commitFilepaths.add(".gitignore");
            }
          }
        }

        for (const change of appliedChanges) {
          const image = preparedImages.get(change);
          if (!image) continue;

          await fsPromises.mkdir(path.dirname(image.mediaPath), {
            recursive: true,
          });
          await fsPromises.writeFile(image.mediaPath, image.buffer);
          writtenImagePaths.push(image.mediaPath);

          await fsPromises.mkdir(path.dirname(image.destPath), {
            recursive: true,
          });
          await fsPromises.writeFile(image.destPath, image.buffer);
          writtenImagePaths.push(image.destPath);
          modifiedFiles.add(image.imageFilepath);

          if (hasGitRepo) {
            await gitAdd({ path: appPath, filepath: image.imageFilepath });
            stagedGitPaths.push({
              appPath,
              filepath: image.imageFilepath,
            });
            commitFilepaths.add(image.imageFilepath);
          }
        }

        let commitHash: string | null = null;
        if (modifiedFiles.size > 0 && hasGitRepo) {
          commitHash = await gitCommit({
            path: appPath,
            message: "Apply visual editing changes",
            paths: [...commitFilepaths],
          });
        }

        return {
          modifiedFiles: [...modifiedFiles],
          commitHash,
          appliedCount: appliedChanges.size,
          skipped,
        };
      } catch (error) {
        // Unstage any image files that were git-added before the failure
        for (const { appPath, filepath } of stagedGitPaths) {
          try {
            await gitResetFile({ path: appPath, filepath });
          } catch {
            // Ignore cleanup errors
          }
        }
        // Clean up any image files written before the failure
        for (const filePath of writtenImagePaths) {
          try {
            await fsPromises.unlink(filePath);
          } catch {
            // Ignore cleanup errors
          }
        }
        for (const { filePath, content, existed } of originalFileContents) {
          try {
            if (existed) {
              await fsPromises.writeFile(filePath, content, "utf-8");
            } else {
              await fsPromises.unlink(filePath);
            }
          } catch {
            // Ignore cleanup errors
          }
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(String(error));
      }
    }),
  );

  createTypedHandler(
    visualEditingContracts.analyzeComponent,
    async (_event, analyseComponentParams) => {
      const { appId, componentId } = analyseComponentParams;
      try {
        const locationParts = componentId.split(":");
        const columnStr = locationParts.pop();
        const lineStr = locationParts.pop();
        const filePath = locationParts.join(":");
        const line = lineStr ? parseInt(lineStr, 10) : NaN;
        const column = columnStr ? parseInt(columnStr, 10) : NaN;

        if (!filePath || isNaN(line) || isNaN(column)) {
          return { isDynamic: false, hasStaticText: false, hasImage: false };
        }

        // Get the app to find its path
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new DyadError(
            `App not found: ${appId}`,
            DyadErrorKind.NotFound,
          );
        }

        const appPath = getDyadAppPath(app.path);
        const fullPath = safeJoin(appPath, filePath);
        const content = await fsPromises.readFile(fullPath, "utf-8");
        return analyzeComponent(content, line, column);
      } catch (error) {
        console.error("Failed to analyze component:", error);
        return { isDynamic: false, hasStaticText: false, hasImage: false };
      }
    },
  );
}
