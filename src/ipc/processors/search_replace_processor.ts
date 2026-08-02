/* eslint-disable no-irregular-whitespace */

import log from "electron-log";

import { parseSearchReplaceBlocks } from "@/shared/search_replace_parser";
import { normalizeString } from "@/utils/text_normalization";

const logger = log.scope("search_replace_processor");

function unescapeMarkers(content: string): string {
  return content
    .replace(/^\\<<<<<<</gm, "<<<<<<<")
    .replace(/^\\=======/gm, "=======")
    .replace(/^\\>>>>>>>/gm, ">>>>>>>");
}

type LineComparator = (fileLine: string, patternLine: string) => boolean;

const MATCHING_PASSES: Array<{
  name: string;
  comparator: LineComparator;
}> = [
  {
    name: "exact",
    comparator: (fileLine, patternLine) => fileLine === patternLine,
  },
  {
    name: "trailing-whitespace-ignored",
    comparator: (fileLine, patternLine) =>
      fileLine.trimEnd() === patternLine.trimEnd(),
  },
  {
    name: "all-edge-whitespace-ignored",
    comparator: (fileLine, patternLine) =>
      fileLine.trim() === patternLine.trim(),
  },
  {
    name: "unicode-normalized",
    comparator: (fileLine, patternLine) =>
      normalizeString(fileLine.trim()) === normalizeString(patternLine.trim()),
  },
];

function trimEmptyLines(lines: string[]): string[] {
  const result = [...lines];
  while (result[0] === "") result.shift();
  while (result[result.length - 1] === "") result.pop();
  return result;
}

function findMatchPositions(
  fileLines: string[],
  searchLines: string[],
  comparator: LineComparator,
): number[] {
  const positions: number[] = [];
  for (let index = 0; index <= fileLines.length - searchLines.length; index++) {
    const matches = searchLines.every((line, offset) =>
      comparator(fileLines[index + offset], line),
    );
    if (matches) {
      positions.push(index);
      if (positions.length > 1) break;
    }
  }
  return positions;
}

function cascadingMatch(
  fileLines: string[],
  searchLines: string[],
): { matchIndex: number; error?: string } {
  for (const pass of MATCHING_PASSES) {
    const positions = findMatchPositions(
      fileLines,
      searchLines,
      pass.comparator,
    );
    if (positions.length > 1) {
      return {
        matchIndex: -1,
        error: `Search block matched multiple locations in the target file (ambiguous, detected in ${pass.name} pass)`,
      };
    }
    if (positions.length === 1) {
      return { matchIndex: positions[0] };
    }
  }
  return {
    matchIndex: -1,
    error: "Search block did not match any content in the target file.",
  };
}

export interface SearchReplaceResult {
  success: boolean;
  content?: string;
  error?: string;
}

/** Apply one or more uniquely matching, whole-line SEARCH/REPLACE blocks. */
export function applySearchReplace(
  originalContent: string,
  diffContent: string,
): SearchReplaceResult {
  const blocks = parseSearchReplaceBlocks(diffContent);
  if (blocks.length === 0) {
    return {
      success: false,
      error:
        "Invalid diff format - missing required sections. Expected <<<<<<< SEARCH / ======= / >>>>>>> REPLACE",
    };
  }

  const lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n";
  let resultLines = originalContent.split(/\r?\n/);

  for (const block of blocks) {
    const searchContent = unescapeMarkers(block.searchContent);
    const replaceContent = unescapeMarkers(block.replaceContent);
    let searchLines = searchContent === "" ? [] : searchContent.split(/\r?\n/);
    const replaceLines =
      replaceContent === "" ? [] : replaceContent.split(/\r?\n/);

    if (searchLines.length === 0) {
      return {
        success: false,
        error: "Invalid diff format - empty SEARCH block is not allowed",
      };
    }

    if (searchLines.join("\n") === replaceLines.join("\n")) {
      logger.warn("Search and replace blocks are identical");
    }

    let matchResult = cascadingMatch(resultLines, searchLines);
    if (matchResult.error && !matchResult.error.includes("ambiguous")) {
      const trimmedSearchLines = trimEmptyLines(searchLines);
      if (trimmedSearchLines.length !== searchLines.length) {
        const trimmedResult = cascadingMatch(resultLines, trimmedSearchLines);
        if (!trimmedResult.error) {
          matchResult = trimmedResult;
          searchLines = trimmedSearchLines;
        }
      }
    }

    if (matchResult.error) {
      return { success: false, error: matchResult.error };
    }

    const matchIndex = matchResult.matchIndex;
    const matchedLines = resultLines.slice(
      matchIndex,
      matchIndex + searchLines.length,
    );
    const matchedIndent = matchedLines[0]?.match(/^[\t ]*/)?.[0] ?? "";
    const searchBaseIndent = searchLines[0]?.match(/^[\t ]*/)?.[0] ?? "";
    const indentedReplaceLines = replaceLines.map((line) => {
      const currentIndent = line.match(/^[\t ]*/)?.[0] ?? "";
      const relativeLevel = currentIndent.length - searchBaseIndent.length;
      const finalIndent =
        relativeLevel < 0
          ? matchedIndent.slice(
              0,
              Math.max(0, matchedIndent.length + relativeLevel),
            )
          : matchedIndent + currentIndent.slice(searchBaseIndent.length);
      return finalIndent + line.trim();
    });

    resultLines = [
      ...resultLines.slice(0, matchIndex),
      ...indentedReplaceLines,
      ...resultLines.slice(matchIndex + searchLines.length),
    ];
  }

  return { success: true, content: resultLines.join(lineEnding) };
}
