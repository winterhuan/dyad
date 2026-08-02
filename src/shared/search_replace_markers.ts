/** Escape marker-like lines so they remain content inside a SEARCH/REPLACE block. */
export function escapeSearchReplaceMarkers(content: string | null): string {
  if (!content) return "";
  return content.replace(
    /^(\\)?(<<<<<<<|=======|>>>>>>>)/gm,
    (full, maybeSlash: string | undefined, marker: string) =>
      maybeSlash ? full : `\\${marker}`,
  );
}
