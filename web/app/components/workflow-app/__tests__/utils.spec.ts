import type { Node } from '@/app/components/workflow/types'
import { BlockEnum, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import {
  buildInitialFeatures,
  buildTriggerStatusMap,
  coerceReplayUserInputs,
  normalizeWorkflowNodesForBackend,
  normalizeWorkflowNodesForFrontend,
} from '../utils'

type HumanInputTestField = {
  type: string
  output_variable_name: string
}

type HumanInputTestNode = Node<{
  inputs: HumanInputTestField[]
}>

describe('workflow-app utils', () => {
  it('should map trigger statuses to enabled and disabled states', () => {
    expect(buildTriggerStatusMap([
      { node_id: 'node-1', status: 'enabled' },
      { node_id: 'node-2', status: 'disabled' },
      { node_id: 'node-3', status: 'paused' },
    ])).toEqual({
      'node-1': 'enabled',
      'node-2': 'disabled',
      'node-3': 'disabled',
    })
  })

  it('should coerce replay run inputs, omit sys keys, and stringify complex values', () => {
    expect(coerceReplayUserInputs({
      'sys.query': 'hidden',
      'query': 'hello',
      'count': 3,
      'enabled': true,
      'nullable': null,
      'metadata': { nested: true },
    })).toEqual({
      query: 'hello',
      count: 3,
      enabled: true,
      nullable: '',
      metadata: '{"nested":true}',
    })
    expect(coerceReplayUserInputs('invalid')).toBeNull()
    expect(coerceReplayUserInputs(null)).toBeNull()
  })

  it('should normalize human-input multi-file types between frontend and backend payloads', () => {
    const nodes: HumanInputTestNode[] = [
      {
        id: 'node-1',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          title: 'Human Input',
          desc: '',
          type: BlockEnum.HumanInput,
          inputs: [
            { type: 'paragraph', output_variable_name: 'summary' },
            { type: 'file-list', output_variable_name: 'attachments' },
          ],
        },
      },
    ]

    const backendNodes = normalizeWorkflowNodesForBackend(nodes) as HumanInputTestNode[]
    expect(backendNodes[0]!.data.inputs).toEqual([
      { type: 'paragraph', output_variable_name: 'summary' },
      { type: 'file_list', output_variable_name: 'attachments' },
    ])

    const frontendPayloadNodes: HumanInputTestNode[] = [
      {
        ...nodes[0]!,
        data: {
          ...nodes[0]!.data,
          inputs: [
            { type: 'paragraph', output_variable_name: 'summary' },
            { type: 'file_list', output_variable_name: 'attachments' },
          ],
        },
      },
    ]

    const frontendNodes = normalizeWorkflowNodesForFrontend(frontendPayloadNodes) as HumanInputTestNode[]

    expect(frontendNodes[0]!.data.inputs).toEqual([
      { type: 'paragraph', output_variable_name: 'summary' },
      { type: 'file-list', output_variable_name: 'attachments' },
    ])
  })

  it('should build initial features with file-upload and feature fallbacks', () => {
    const result = buildInitialFeatures({
      file_upload: {
        enabled: true,
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_extensions: ['.png'],
        allowed_file_upload_methods: [TransferMethod.local_file],
        number_limits: 2,
        image: {
          enabled: true,
          number_limits: 5,
          transfer_methods: [TransferMethod.remote_url],
        },
      },
      opening_statement: 'hello',
      suggested_questions: ['Q1'],
      suggested_questions_after_answer: { enabled: true },
      speech_to_text: { enabled: true },
      text_to_speech: { enabled: true },
      retriever_resource: { enabled: true },
      sensitive_word_avoidance: { enabled: true },
    }, { enabled: true } as never)

    expect(result).toMatchObject({
      file: {
        enabled: true,
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_extensions: ['.png'],
        allowed_file_upload_methods: [TransferMethod.local_file],
        number_limits: 2,
        fileUploadConfig: { enabled: true },
        image: {
          enabled: true,
          number_limits: 5,
          transfer_methods: [TransferMethod.remote_url],
        },
      },
      opening: {
        enabled: true,
        opening_statement: 'hello',
        suggested_questions: ['Q1'],
      },
      suggested: { enabled: true },
      speech2text: { enabled: true },
      text2speech: { enabled: true },
      citation: { enabled: true },
      moderation: { enabled: true },
    })
  })
})
