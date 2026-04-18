import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { render } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import MixedVariableTextInput from '../index'

let capturedPromptEditorProps: PromptEditorProps[] = []

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: ({
    editable,
    value,
    workflowVariableBlock,
    onChange,
  }: PromptEditorProps) => {
    capturedPromptEditorProps.push({
      editable,
      value,
      onChange,
      workflowVariableBlock,
    })

    return (
      <div data-testid="prompt-editor">
        <div data-testid="editable-flag">{editable ? 'editable' : 'readonly'}</div>
        <div data-testid="value-flag">{value || 'empty'}</div>
        <button type="button" onClick={() => onChange?.('updated text')}>trigger-change</button>
      </div>
    )
  },
}))

describe('MixedVariableTextInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedPromptEditorProps = []
  })

  it('should pass workflow variable metadata to the prompt editor and include system variables for start nodes', () => {
    const nodesOutputVars: NodeOutPutVar[] = [{
      nodeId: 'node-1',
      title: 'Question Node',
      vars: [],
    }]
    const availableNodes: Node[] = [
      {
        id: 'start-node',
        position: { x: 0, y: 0 },
        data: {
          title: 'Start Node',
          desc: 'Start description',
          type: BlockEnum.Start,
        },
      },
      {
        id: 'llm-node',
        position: { x: 120, y: 0 },
        data: {
          title: 'LLM Node',
          desc: 'LLM description',
          type: BlockEnum.LLM,
        },
      },
    ]

    render(
      <MixedVariableTextInput
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
      />,
    )

    const latestProps = capturedPromptEditorProps.at(-1)

    expect(latestProps?.editable).toBe(true)
    expect(latestProps?.workflowVariableBlock?.variables).toHaveLength(1)
    expect(latestProps?.workflowVariableBlock?.workflowNodesMap).toEqual({
      'start-node': {
        title: 'Start Node',
        type: 'start',
      },
      'sys': {
        title: 'workflow.blocks.start',
        type: 'start',
      },
      'llm-node': {
        title: 'LLM Node',
        type: 'llm',
      },
    })
  })

  it('should forward read-only state, current value, and change callbacks', async () => {
    const onChange = vi.fn()
    const { findByRole, getByTestId } = render(
      <MixedVariableTextInput
        readOnly
        value="seed value"
        onChange={onChange}
      />,
    )

    expect(getByTestId('editable-flag')).toHaveTextContent('readonly')
    expect(getByTestId('value-flag')).toHaveTextContent('seed value')

    const changeButton = await findByRole('button', { name: 'trigger-change' })
    changeButton.click()

    expect(onChange).toHaveBeenCalledWith('updated text')
  })
})
