import type { Node, ValueSelector, Var } from '@/app/components/workflow/types'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VarType } from '@/app/components/workflow/types'
import InstructionEditorInWorkflow from '../instruction-editor-in-workflow'
import { GeneratorType } from '../types'

const mockPromptEditor = vi.fn()
const mockUseAvailableVarList = vi.fn()
const mockGetState = vi.fn()
const mockUseWorkflowVariableType = vi.fn()

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: Record<string, unknown>) => {
    mockPromptEditor(props)
    return <div data-testid="prompt-editor">{String(props.value ?? '')}</div>
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mockGetState,
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowVariableType: () => mockUseWorkflowVariableType(),
}))

const availableNodes: Node[] = [{
  data: {
    title: 'Node A',
    type: 'llm',
  },
  height: 80,
  id: 'node-a',
  position: { x: 0, y: 0 },
  width: 160,
}] as unknown as Node[]

describe('InstructionEditorInWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetState.mockReturnValue({
      nodesWithInspectVars: [{ nodeId: 'node-a' }, { nodeId: 'node-b' }],
    })
    mockUseWorkflowVariableType.mockReturnValue(() => 'string')
    mockUseAvailableVarList.mockReturnValue({
      availableNodes,
      availableVars: [{ value_selector: ['node-a', 'text'] }],
    })
  })

  it('should wire workflow variables into the shared instruction editor', () => {
    render(
      <InstructionEditorInWorkflow
        editorKey="workflow-editor"
        generatorType={GeneratorType.prompt}
        isShowCurrentBlock
        nodeId="node-a"
        onChange={vi.fn()}
        value="Workflow prompt"
      />,
    )

    const filterVar = mockUseAvailableVarList.mock.calls[0][1].filterVar as (payload: Var, selector: ValueSelector) => boolean
    expect(filterVar({ type: VarType.string } as Var, ['node-a'])).toBe(true)
    expect(filterVar({ type: VarType.file } as Var, ['node-a'])).toBe(false)
    expect(filterVar({ type: VarType.string } as Var, ['node-c'])).toBe(false)

    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      currentBlock: {
        generatorType: GeneratorType.prompt,
        show: true,
      },
      lastRunBlock: {
        show: true,
      },
      value: 'Workflow prompt',
      workflowVariableBlock: expect.objectContaining({
        show: true,
        variables: [{ value_selector: ['node-a', 'text'] }],
      }),
    }))
  })
})
