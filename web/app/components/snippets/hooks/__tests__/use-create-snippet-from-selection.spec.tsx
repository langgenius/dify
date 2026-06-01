import type { ReactElement } from 'react'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { act, renderHook } from '@testing-library/react'
import { SNIPPET_INPUT_FIELD_NODE_ID } from '@/app/components/workflow/nodes/_base/hooks/snippet-input-field-vars'
import { BlockEnum } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'
import { useCreateSnippetFromSelection } from '../use-create-snippet-from-selection'

const mockHandleOpenCreateSnippetDialog = vi.fn()
const mockHandleCloseCreateSnippetDialog = vi.fn()
const mockHandleCreateSnippet = vi.fn()

vi.mock('../use-create-snippet', () => ({
  useCreateSnippet: () => ({
    createSnippetMutation: {
      isPending: false,
    },
    handleCloseCreateSnippetDialog: mockHandleCloseCreateSnippetDialog,
    handleCreateSnippet: mockHandleCreateSnippet,
    handleOpenCreateSnippetDialog: mockHandleOpenCreateSnippetDialog,
    isCreateSnippetDialogOpen: true,
    isCreatingSnippet: false,
  }),
}))

type DialogProps = {
  selectedGraph?: SnippetCanvasData
  inputFields?: SnippetInputField[]
}

const createNode = (
  id: string,
  data: Record<string, unknown>,
): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  width: 200,
  height: 100,
  data,
} as unknown as Node)

describe('useCreateSnippetFromSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should convert environment, conversation, and system variables into snippet input fields', () => {
    const selectedNodes = [
      createNode('llm', {
        type: BlockEnum.LLM,
        prompt: [
          '{{#env.API_KEY#}}',
          '{{#conversation.user_name#}}',
          '{{#sys.user_id#}}',
          '{{#rag.query#}}',
          '{{#source.result#}}',
        ].join(' '),
        model_selector: ['env', 'MODEL_NAME'],
      }),
    ]
    const edges: Edge[] = []
    const onClose = vi.fn()

    const { result } = renderHook(() => useCreateSnippetFromSelection({
      edges,
      selectedNodes,
      onClose,
    }))

    act(() => {
      result.current.handleOpenCreateSnippet()
    })

    const dialogProps = (result.current.createSnippetDialog as ReactElement<DialogProps>).props

    expect(dialogProps.inputFields).toEqual([
      {
        label: 'API_KEY',
        variable: 'API_KEY',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'user_name',
        variable: 'user_name',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'user_id',
        variable: 'user_id',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'result',
        variable: 'result',
        type: PipelineInputVarType.textInput,
        required: true,
      },
      {
        label: 'MODEL_NAME',
        variable: 'MODEL_NAME',
        type: PipelineInputVarType.textInput,
        required: true,
      },
    ])
    const nodeData = dialogProps.selectedGraph?.nodes[0]?.data as Record<string, unknown> | undefined

    expect(nodeData?.prompt).toBe([
      `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.API_KEY#}}`,
      `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.user_name#}}`,
      `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.user_id#}}`,
      '{{#rag.query#}}',
      `{{#${SNIPPET_INPUT_FIELD_NODE_ID}.result#}}`,
    ].join(' '))
    expect(nodeData?.model_selector).toEqual([
      SNIPPET_INPUT_FIELD_NODE_ID,
      'MODEL_NAME',
    ])
    expect(onClose).toHaveBeenCalled()
  })
})
