import type { ReactNode } from 'react'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { isValidElement } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import MixedVariableTextInput from '../index'

type MockPromptEditorProps = {
  wrapperClassName: string
  className: string
  editable: boolean
  value: string
  workflowVariableBlock: {
    show: boolean
    variables: NodeOutPutVar[]
    workflowNodesMap: Record<string, { title: string, type: BlockEnum }>
    showManageInputField?: boolean
    onManageInputField?: () => void
  }
  placeholder: ReactNode
  onChange?: (text: string) => void
}

const mockPromptEditor = vi.fn<(props: MockPromptEditorProps) => void>()

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: MockPromptEditorProps) => {
    mockPromptEditor(props)
    return (
      <button type="button" onClick={() => props.onChange?.('updated value')}>
        prompt-editor
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { controlPromptEditorRerenderKey: string }) => unknown) => selector({
    controlPromptEditorRerenderKey: 'rerender-key',
  }),
}))

describe('tool/mixed-variable-text-input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should map workflow variable props into the prompt editor', () => {
    const handleChange = vi.fn()
    const handleManageInputField = vi.fn()
    const nodesOutputVars: NodeOutPutVar[] = [{
      nodeId: 'tool-node',
      title: 'Search Tool',
      vars: [],
    }]
    const availableNodes = [
      {
        id: 'start-node',
        data: {
          title: 'Start Title',
          type: BlockEnum.Start,
        },
      },
      {
        id: 'tool-node',
        data: {
          title: 'Search Tool',
          type: BlockEnum.Tool,
        },
      },
    ] as Node[]

    render(
      <MixedVariableTextInput
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
        value="initial value"
        onChange={handleChange}
        showManageInputField
        onManageInputField={handleManageInputField}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'prompt-editor' }))

    expect(handleChange).toHaveBeenCalledWith('updated value')
    expect(mockPromptEditor.mock.calls[0]![0]).toMatchObject({
      editable: true,
      value: 'initial value',
      workflowVariableBlock: {
        show: true,
        variables: nodesOutputVars,
        showManageInputField: true,
        onManageInputField: handleManageInputField,
        workflowNodesMap: {
          'tool-node': {
            title: 'Search Tool',
            type: BlockEnum.Tool,
          },
          'start-node': {
            title: 'Start Title',
            type: BlockEnum.Start,
          },
          'sys': {
            title: 'workflow.blocks.start',
            type: BlockEnum.Start,
          },
        },
      },
    })
    expect(isValidElement(mockPromptEditor.mock.calls[0]![0].placeholder)).toBe(true)
  })

  it('should disable editing and variable insertion when requested', () => {
    render(
      <MixedVariableTextInput
        readOnly
        disableVariableInsertion
      />,
    )

    expect(mockPromptEditor.mock.calls[0]![0]).toMatchObject({
      editable: false,
      value: '',
      workflowVariableBlock: {
        show: false,
        variables: [],
        workflowNodesMap: {},
        showManageInputField: undefined,
        onManageInputField: undefined,
      },
    })
    expect(isValidElement(mockPromptEditor.mock.calls[0]![0].placeholder)).toBe(true)
  })
})
