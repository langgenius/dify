import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'

/** SSE-only append operation; stored history continues to use complete content blocks. */
export type OpenUIContentDelta = Pick<OpenUIContentBlock, 'id' | 'sequence'> & {
  type: 'openui_delta'
  base_sequence: number
  source_delta: string
}

/** Chat SSE envelope. Snapshots share the generated history contract. */
export type MessageContentEvent = {
  event: 'message_content'
  message_id: string
  conversation_id: string
  task_id: string
  data: OpenUIContentBlock | OpenUIContentDelta
}
