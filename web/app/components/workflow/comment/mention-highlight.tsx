import type { ReactNode } from 'react'

/**
 * Splits comment text so each `@name` of a known user renders in the accent
 * color. A mention must start the text or follow whitespace; when names
 * share a prefix the longest one wins.
 */
export function highlightMentions(content: string, mentionNames: string[]): ReactNode {
  if (!content) return ''

  const names = Array.from(new Set(mentionNames.map((name) => name.trim()).filter(Boolean)))
  names.sort((a, b) => b.length - a.length)
  if (names.length === 0) return content

  const segments: ReactNode[] = []
  let hasMention = false
  let cursor = 0

  while (cursor < content.length) {
    let nextMatchStart = -1
    let matchedName = ''

    for (const name of names) {
      const searchStart = content.indexOf(`@${name}`, cursor)
      if (searchStart === -1) continue

      const previousChar = searchStart > 0 ? content[searchStart - 1] : ''
      if (searchStart > 0 && !/\s/.test(previousChar!)) continue

      if (
        nextMatchStart === -1 ||
        searchStart < nextMatchStart ||
        (searchStart === nextMatchStart && name.length > matchedName.length)
      ) {
        nextMatchStart = searchStart
        matchedName = name
      }
    }

    if (nextMatchStart === -1) break

    if (nextMatchStart > cursor)
      segments.push(<span key={`text-${cursor}`}>{content.slice(cursor, nextMatchStart)}</span>)

    const mentionEnd = nextMatchStart + matchedName.length + 1
    segments.push(
      <span key={`mention-${nextMatchStart}`} className="text-text-accent">
        {content.slice(nextMatchStart, mentionEnd)}
      </span>,
    )
    hasMention = true
    cursor = mentionEnd
  }

  if (!hasMention) return content

  if (cursor < content.length)
    segments.push(<span key={`text-${cursor}`}>{content.slice(cursor)}</span>)

  return segments
}
