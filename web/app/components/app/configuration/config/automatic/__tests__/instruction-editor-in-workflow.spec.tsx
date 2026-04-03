import { render, screen } from '@testing-library/react'
import { VarType } from '@/app/components/workflow/types'
import InstructionEditorInWorkflow from '../instruction-editor-in-workflow'
import { GeneratorType } from '../types'

const mockUseAvailableVarList = vi.fn()
const mockUseWorkflowVariableType = vi.fn()
const mockGetState = vi.fn()
const mockInstructionEditor = vi.fn()
const filterResults: boolean[] = []

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockGetState,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowVariableType: () => mockUseWorkflowVariableType(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (nodeId: string, options: { filterVar: (payload: { type: VarType }, selector: string[]) => boolean }) => {
    filterResults.push(
      options.filterVar({ type: VarType.string }, ['node-1']),
      options.filterVar({ type: VarType.file }, ['node-1']),
      options.filterVar({ type: VarType.arrayFile }, ['node-1']),
      options.filterVar({ type: VarType.string }, ['node-x']),
    )
    return mockUseAvailableVarList(nodeId, options)
  },
}))

vi.mock('../instruction-editor', () => ({
  default: (props: Record<string, unknown>) => {
    mockInstructionEditor(props)
    return <div data-testid="instruction-editor">{String(props.editorKey)}</div>
  },
}))

describe('InstructionEditorInWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    filterResults.length = 0
    mockGetState.mockReturnValue({
      nodesWithInspectVars: [{ nodeId: 'node-1' }],
    })
    mockUseWorkflowVariableType.mockReturnValue('var-type-fn')
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [{ variable: 'query' }],
      availableNodes: [{ id: 'node-1', data: { title: 'Node 1', type: 'llm' } }],
    })
  })

  it('should filter workflow variables and forward the resolved props to the editor', () => {
    render(
      <InstructionEditorInWorkflow
        nodeId="current-node"
        value="instruction"
        editorKey="editor-1"
        onChange={vi.fn()}
        generatorType={GeneratorType.prompt}
        isShowCurrentBlock
      />,
    )

    expect(screen.getByTestId('instruction-editor')).toHaveTextContent('editor-1')
    expect(filterResults).toEqual([true, false, false, false])
    expect(mockUseAvailableVarList).toHaveBeenCalledWith('current-node', expect.objectContaining({
      onlyLeafNodeVar: false,
    }))
    expect(mockInstructionEditor).toHaveBeenCalledWith(expect.objectContaining({
      value: 'instruction',
      availableVars: [{ variable: 'query' }],
      availableNodes: [{ id: 'node-1', data: { title: 'Node 1', type: 'llm' } }],
      getVarType: 'var-type-fn',
      isShowCurrentBlock: true,
      isShowLastRunBlock: true,
    }))
  })
})
