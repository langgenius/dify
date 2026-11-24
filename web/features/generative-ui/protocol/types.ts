import type {
  OpenUiContentBlock as OpenUIContentBlock,
  TextContentPart,
} from '@dify/contracts/api/console/agent/types.gen'

/** Ordered response part stored in message metadata and returned by history APIs. */
export type MessageContentPart = TextContentPart | OpenUIContentBlock

/** SSE-only append operation; stored history continues to use complete content parts. */
export type OpenUIContentDelta = Pick<OpenUIContentBlock, 'id' | 'sequence'> & {
  type: 'openui_delta'
  base_sequence: number
  source_delta: string
}

/** Chat or Workflow SSE envelope. Snapshots share the generated history contract. */
export type MessageContentEvent = {
  event: 'message_content'
  message_id?: string
  conversation_id?: string
  workflow_run_id?: string
  task_id: string
  data: OpenUIContentBlock | OpenUIContentDelta
}
