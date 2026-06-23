import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import MailBodyInput from '../mail-body-input'

const mockPromptEditor = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/base/prompt-editor', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPromptEditor(props)
    return <div data-testid="prompt-editor" />
  },
}))

vi.mock('@/app/components/workflow/nodes/tool/components/mixed-variable-text-input/placeholder', () => ({
  __esModule: true,
  default: (_props: { hideBadge?: boolean }) => <div data-testid="placeholder" />,
}))

describe('human-input/delivery-method/mail-body-input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass prompt editor config with sys start mapping when a start node is available', () => {
    const handleChange = vi.fn()
    const nodesOutputVars = [{ nodeId: 'start', title: 'Start', vars: [] }] as NodeOutPutVar[]
    const availableNodes = [
      {
        id: 'start',
        data: { title: 'Start Node', type: BlockEnum.Start },
      },
      {
        id: 'answer',
        data: { title: 'Answer Node', type: BlockEnum.Answer },
      },
    ] as unknown as Node[]

    render(
      <MailBodyInput
        value="Hello {{#url#}}"
        onChange={handleChange}
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
      />,
    )

    expect(screen.getByTestId('prompt-editor')).toBeInTheDocument()
    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      editable: true,
      value: 'Hello {{#url#}}',
      onChange: handleChange,
      placeholder: expect.any(Object),
      requestURLBlock: {
        show: true,
        selectable: true,
      },
      workflowVariableBlock: {
        show: true,
        variables: nodesOutputVars,
        workflowNodesMap: {
          start: { title: 'Start Node', type: BlockEnum.Start },
          answer: { title: 'Answer Node', type: BlockEnum.Answer },
          sys: { title: 'workflow.blocks.start', type: BlockEnum.Start },
        },
      },
    }))
  })

  it('should disable editing and omit sys mapping when there is no start node', () => {
    render(
      <MailBodyInput
        readOnly
        availableNodes={[{
          id: 'llm',
          data: { title: 'LLM Node', type: BlockEnum.LLM },
        }] as unknown as Node[]}
      />,
    )

    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      editable: false,
      value: '',
      workflowVariableBlock: {
        show: true,
        variables: [],
        workflowNodesMap: {
          llm: { title: 'LLM Node', type: BlockEnum.LLM },
        },
      },
    }))
  })
})
