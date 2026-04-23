import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import PromptResInWorkflow from '../prompt-res-in-workflow'

const mockUseAvailableVarList = vi.fn()
const mockPromptRes = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

vi.mock('../prompt-res', () => ({
  default: (props: Record<string, unknown>) => {
    mockPromptRes(props)
    return <div data-testid="prompt-res">{String(props.value)}</div>
  },
}))

describe('PromptResInWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [{ variable: 'query' }],
      availableNodes: [
        {
          id: 'node-1',
          data: { title: 'Retriever', type: BlockEnum.KnowledgeRetrieval },
          width: 120,
          height: 80,
          position: { x: 1, y: 2 },
        },
        {
          id: 'start-node',
          data: { title: 'Start node', type: BlockEnum.Start },
          width: 100,
          height: 60,
          position: { x: 0, y: 0 },
        },
      ],
    })
  })

  it('should build the workflow variable map and include the synthetic start node entry', () => {
    render(<PromptResInWorkflow value="prompt" nodeId="node-a" />)

    expect(screen.getByTestId('prompt-res')).toHaveTextContent('prompt')
    expect(mockUseAvailableVarList).toHaveBeenCalledWith('node-a', expect.objectContaining({
      onlyLeafNodeVar: false,
    }))
    expect(mockPromptRes).toHaveBeenCalledWith(expect.objectContaining({
      workflowVariableBlock: expect.objectContaining({
        show: true,
        variables: [{ variable: 'query' }],
        workflowNodesMap: expect.objectContaining({
          'node-1': expect.objectContaining({
            title: 'Retriever',
            type: BlockEnum.KnowledgeRetrieval,
          }),
          'sys': expect.objectContaining({
            title: 'blocks.start',
            type: BlockEnum.Start,
          }),
        }),
      }),
    }))
  })

  it('should fall back to an empty variable list when the workflow hook returns no variables', () => {
    mockUseAvailableVarList.mockReturnValueOnce({
      availableVars: undefined,
      availableNodes: [],
    })

    render(<PromptResInWorkflow value="fallback" nodeId="node-b" />)

    expect(mockPromptRes).toHaveBeenCalledWith(expect.objectContaining({
      workflowVariableBlock: expect.objectContaining({
        variables: [],
        workflowNodesMap: {},
      }),
    }))
  })
})
