import type { MessageDetailResponse } from '@dify/contracts/api/console/agent/types.gen'

export const createAgentFileHistoryMessage = (): MessageDetailResponse => ({
  id: 'message',
  conversation_id: 'conversation',
  query: 'Create a report',
  answer: 'Report delivered',
  inputs: {},
  metadata: {},
  message: [],
  feedbacks: [],
  from_source: 'console',
  status: 'normal',
  answer_tokens: 1,
  message_tokens: 1,
  provider_response_latency: 0,
  agent_thoughts: [
    {
      id: 'thought',
      message_id: 'message',
      tool: 'create_report',
      tool_input: '{}',
      tool_labels: {},
      observation: 'Report delivered',
      position: 1,
      files: ['deleted-file', 'message-file'],
    },
  ],
  message_files: [
    {
      id: 'message-file',
      upload_file_id: 'tool-file',
      belongs_to: 'assistant',
      filename: 'report.pdf',
      type: 'document',
      mime_type: 'application/pdf',
      size: 42,
      transfer_method: 'tool_file',
      url: 'https://files.test/report.pdf?sign=report',
    },
  ],
})
