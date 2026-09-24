import type { ConversationItem, SessionView } from '../types'

export const isCompletedView = (view: SessionView) => view.run_status === 'complete'

export const mergeConversation = (
  current: ConversationItem[],
  committed: ConversationItem[],
): ConversationItem[] => {
  const bySequence = new Map(current.map((item) => [item.seq, item]))
  committed.forEach((item) => bySequence.set(item.seq, item))
  return [...bySequence.values()].sort((left, right) => left.seq - right.seq)
}

export const hasConversationRange = (
  items: ConversationItem[],
  afterSequence: number,
  throughSequence: number,
) => {
  if (throughSequence <= afterSequence) return true
  const sequences = new Set(items.map((item) => item.seq))
  for (let sequence = afterSequence + 1; sequence <= throughSequence; sequence += 1) {
    if (!sequences.has(sequence)) return false
  }
  return true
}

export const projectSessionView = (
  current: SessionView | null,
  next: SessionView,
): SessionView | null => {
  if (current?.session_id === next.session_id && next.version < current.version) return null
  return next
}
