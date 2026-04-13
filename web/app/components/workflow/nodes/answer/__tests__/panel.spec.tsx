import type { AnswerNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'

type MockEditorProps = {
  readOnly: boolean
  title: string
  value: string
  onChange: (value: string) => void
  nodesOutputVars: unknown[]
  availableNodes: unknown[]
}

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockUseAvailableVarList = vi.hoisted(() => vi.fn())
const mockEditorRender = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  __esModule: true,
  default: (props: MockEditorProps) => {
    mockEditorRender(props)
    return (
      <button type="button" onClick={() => props.onChange('Updated answer')}>
        {props.title}
        :
        {props.value}
      </button>
    )
  },
}))

const createData = (overrides: Partial<AnswerNodeType> = {}): AnswerNodeType => ({
  title: 'Answer',
  desc: '',
  type: BlockEnum.Answer,
  variables: [],
  answer: 'Initial answer',
  ...overrides,
})

describe('AnswerPanel', () => {
  const handleAnswerChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue({
      readOnly: false,
      inputs: createData(),
      handleAnswerChange,
      filterVar: vi.fn(),
    })
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [{ variable: 'context', type: 'string' }],
      availableNodesWithParent: [{ value: 'node-1', label: 'Node 1' }],
    })
  })

  it('should pass editor state and available variables through to the prompt editor', () => {
    render(<Panel id="answer-node" data={createData()} panelProps={{} as PanelProps} />)

    expect(screen.getByRole('button', { name: 'workflow.nodes.answer.answer:Initial answer' })).toBeInTheDocument()
    expect(mockEditorRender).toHaveBeenCalledWith(expect.objectContaining({
      readOnly: false,
      title: 'workflow.nodes.answer.answer',
      value: 'Initial answer',
      nodesOutputVars: [{ variable: 'context', type: 'string' }],
      availableNodes: [{ value: 'node-1', label: 'Node 1' }],
      isSupportFileVar: true,
      justVar: true,
    }))
  })

  it('should delegate answer edits to use-config', () => {
    render(<Panel id="answer-node" data={createData()} panelProps={{} as PanelProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.answer.answer:Initial answer' }))

    expect(handleAnswerChange).toHaveBeenCalledWith('Updated answer')
  })
})
