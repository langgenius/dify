import type { MessageDetailResponse } from '@dify/contracts/api/console/agent/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import { getFormattedAgentDebugChatTree } from '../chat-history'

describe('Agent history knowledge evidence', () => {
  it('preserves trusted receipt identity, source content and version on history reload', () => {
    const citation = {
      id: `kfs_${'a'.repeat(32)}`,
      control_space_id: '00000000-0000-4000-8000-000000000001',
      space_name: 'Docs',
      node_id: 'node',
      document_asset_id: 'doc',
      artifact_hash: 'hash',
      document_version: 2,
      parse_artifact_id: 'parse',
    }
    const message: MessageDetailResponse = {
      id: 'message',
      conversation_id: 'conversation',
      answer: `[Manual](kfs://${citation.id})`,
      query: 'Question',
      inputs: {},
      metadata: {},
      message: [],
      agent_thoughts: [],
      message_files: [],
      feedbacks: [],
      from_source: 'console',
      status: 'normal',
      answer_tokens: 1,
      message_tokens: 1,
      provider_response_latency: 0,
      retriever_resources: [
        {
          knowledge_fs_citation: citation,
          content: 'evidence',
          data_source_type: 'knowledge_fs',
          dataset_id: citation.control_space_id,
          dataset_name: 'Docs',
          document_id: 'doc',
          document_asset_id: 'doc',
          document_version: 2,
          document_name: 'Manual',
        },
      ],
    }
    const answer = getFormattedAgentDebugChatTree([message])[0]?.children?.[0]
    expect(answer?.content).toBe(message.answer)
    expect(answer?.citation?.[0]).toMatchObject({
      knowledge_fs_citation: citation,
      document_asset_id: 'doc',
      document_version: 2,
      content: 'evidence',
    })
    expect(
      getFormattedAgentDebugChatTree([{ ...message, retriever_resources: undefined }])[0]
        ?.children?.[0]?.citation,
    ).toBeUndefined()
  })
})
