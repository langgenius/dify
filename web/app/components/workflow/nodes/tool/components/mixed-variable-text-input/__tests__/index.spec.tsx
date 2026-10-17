import type { ComponentProps } from 'react'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import MixedVariableTextInput from '../index'

type MockPromptEditorProps = ComponentProps<
  typeof import('@/app/components/base/prompt-editor').default
>
const mockPromptEditor = vi.fn<(props: MockPromptEditorProps) => void>()

// The editor has its own interaction tests. This adapter owns node-to-variable metadata.
vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: MockPromptEditorProps) => {
    mockPromptEditor(props)
    return null
  },
}))

describe('tool/mixed-variable-text-input', () => {
  it('should map workflow variable props into the prompt editor', () => {
    const handleManageInputField = vi.fn()
    const nodesOutputVars: NodeOutPutVar[] = [
      {
        nodeId: 'tool-node',
        title: 'Search Tool',
        vars: [],
      },
    ]
    const availableNodes = [
      createNode({
        id: 'start-node',
        data: {
          title: 'Start Title',
          type: BlockEnum.Start,
        },
      }),
      createNode({
        id: 'tool-node',
        data: {
          title: 'Search Tool',
          type: BlockEnum.Tool,
        },
      }),
    ]

    render(
      <MixedVariableTextInput
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
        value="initial value"
        showManageInputField
        onManageInputField={handleManageInputField}
      />,
    )

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
          sys: {
            title: 'workflow.blocks.start',
            type: BlockEnum.Start,
          },
        },
      },
    })
  })

  it('should disable editing and variable insertion when requested', () => {
    render(<MixedVariableTextInput readOnly disableVariableInsertion />)

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
  })
})
