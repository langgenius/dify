import type { ReactNode } from 'react'

type Mention = { start: number; end: number; name: string }

/**
 * The `@name` mentions of known users in comment text, in order. A mention must start the text
 * or follow whitespace; when names share a prefix the longest one wins.
 */
export function findMentions(content: string, mentionNames: string[]): Mention[] {
  const names = Array.from(new Set(mentionNames.map((name) => name.trim()).filter(Boolean)))
  names.sort((a, b) => b.length - a.length)
  const mentions: Mention[] = []
  let cursor = 0

  while (names.length && cursor < content.length) {
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
    const end = nextMatchStart + matchedName.length + 1
    mentions.push({ start: nextMatchStart, end, name: matchedName })
    cursor = end
  }

  return mentions
}

/** Splits comment text so each `@name` of a known user renders in the accent color. */
export function highlightMentions(content: string, mentionNames: string[]): ReactNode {
  if (!content) return ''
  const mentions = findMentions(content, mentionNames)
  if (!mentions.length) return content

  const segments: ReactNode[] = []
  let cursor = 0
  for (const { start, end } of mentions) {
    if (start > cursor)
      segments.push(<span key={`text-${cursor}`}>{content.slice(cursor, start)}</span>)
    segments.push(
      <span key={`mention-${start}`} className="text-text-accent">
        {content.slice(start, end)}
      </span>,
    )
    cursor = end
  }
  if (cursor < content.length)
    segments.push(<span key={`text-${cursor}`}>{content.slice(cursor)}</span>)
  return segments
}
