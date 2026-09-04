import type { DifyBuilderCommitEventData } from '@dify/contracts/api/console/dify-builder/types.gen'
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

export const projectSessionView = (
  current: SessionView | null,
  next: SessionView,
): SessionView | null => {
  if (current?.session_id === next.session_id && next.version < current.version) return null
  return next
}

export const projectCommit = (
  current: SessionView | null,
  commit: DifyBuilderCommitEventData,
): SessionView | null => {
  if (
    !current ||
    current.session_id !== commit.session_id ||
    commit.at_version !== commit.version ||
    commit.version <= current.version
  )
    return null

  return {
    ...current,
    version: commit.version,
    state: commit.state,
    canvas_read_only: true,
    run_status: 'executing',
  }
}
