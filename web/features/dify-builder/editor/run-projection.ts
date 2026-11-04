import type { ConversationItem } from '../types'
import { groupConversationItems } from '../conversation/group-conversation-items'

export type BuilderRun = {
  sessionId: string
  runId: string
  atVersion: number
}

export const getHistoricalRun = (
  sessionId: string,
  items: ConversationItem[],
): BuilderRun | null => {
  const latest = groupConversationItems(items)
    .flatMap((group) =>
      group.invalidated ? [] : group.type === 'assistant' ? group.cards : [group.item],
    )
    .reverse()
    .find((item) => item.kind === 'test_result' && item.payload.dify_run_id)
  if (latest?.kind !== 'test_result') return null
  return {
    sessionId,
    runId: latest.payload.dify_run_id!,
    atVersion: latest.at_version,
  }
}
