import type { CitationItem } from '../type'

/** Only authenticated response metadata can make an Agent's receipt link actionable. */
export function resolveKnowledgeCitationLinks(
  content: string,
  sources: CitationItem[] = [],
): string {
  const receipts = new Set(
    sources.flatMap((source) =>
      source.knowledge_fs_citation ? [source.knowledge_fs_citation.id] : [],
    ),
  )
  return content.replace(
    /\[([^\]\n]{1,200})\]\(kfs:\/\/(kfs_[a-f0-9]{32})\)/g,
    (_match, label: string, receipt: string) =>
      receipts.has(receipt) ? `[${label}](#${receipt})` : label,
  )
}
