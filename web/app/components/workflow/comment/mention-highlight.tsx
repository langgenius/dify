import type { ReactNode } from 'react'

type Mention = { start: number; end: number; name: string }

/**
 * The `@name` mentions of known users in comment text, in order. A mention starts the text or
 * follows whitespace, and its name does not run on into more letters or digits; where names
 * share a prefix, the longest that fits wins.
 */
export function findMentions(content: string, mentionNames: string[]): Mention[] {
  const names = Array.from(new Set(mentionNames.map((name) => name.trim()).filter(Boolean)))
  names.sort((a, b) => b.length - a.length)
  const mentions: Mention[] = []
  if (!names.length) return mentions

  let at = content.indexOf('@')
  while (at !== -1) {
    const startsWord = at === 0 || /\s/.test(content[at - 1]!)
    const name = startsWord
      ? names.find((candidate) => {
          if (!content.startsWith(candidate, at + 1)) return false
          const next = content[at + 1 + candidate.length]
          return next === undefined || !/[\p{L}\p{N}_]/u.test(next)
        })
      : undefined
    if (name) {
      const end = at + 1 + name.length
      mentions.push({ start: at, end, name })
      at = content.indexOf('@', end)
    } else {
      at = content.indexOf('@', at + 1)
    }
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
