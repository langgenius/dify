import type { ConversationItem, SessionView } from '../types'

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
  if (current?.session_id === next.session_id && next.version === current.version) {
    const previous = current.test_execution
    const incoming = next.test_execution
    if (
      previous &&
      incoming?.request_id === previous.request_id &&
      (incoming.generation < previous.generation ||
        (incoming.generation === previous.generation && incoming.version < previous.version) ||
        (incoming.generation === previous.generation &&
          incoming.version === previous.version &&
          (incoming.decision_public_revision ?? 0) < (previous.decision_public_revision ?? 0)))
    )
      return null
  }
  const previous = current?.test_execution
  const incoming = next.test_execution
  const path = previous?.canvas_path
  if (
    current?.session_id === next.session_id &&
    path &&
    incoming &&
    previous.request_id === incoming.request_id &&
    path.native_run_id === incoming.native_run_id &&
    path.revision > (incoming.canvas_path?.revision ?? 0)
  )
    return { ...next, test_execution: { ...incoming, canvas_path: path } }
  return next
}

export const isActiveView = (view: SessionView) => view.command_pending === true

export const hasUnresolvedNativeTest = (view: SessionView | null) =>
  Boolean(
    view?.test_execution &&
    (view.test_execution.status !== 'terminal' ||
      view.test_execution.outcome === 'unknown' ||
      view.test_execution.cancellation?.status === 'cancelling'),
  )

export const mergeConversationPage = (current: ConversationItem[], page: ConversationItem[]) => {
  const versions = new Map(current.map((item) => [item.seq, item.at_version]))
  return mergeConversation(
    current,
    page.filter((item) => (versions.get(item.seq) ?? -1) <= item.at_version),
  )
}
