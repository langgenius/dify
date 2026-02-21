import type { LexicalEditor } from 'lexical'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReactFlow, useStoreApi } from 'reactflow'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { useSelectOrDelete } from '../../hooks'
import WorkflowVariableBlockComponent from './component'
import { UPDATE_WORKFLOW_NODES_MAP } from './index'
import { WorkflowVariableBlockNode } from './node'

const { mockVarLabel, mockIsExceptionVariable, mockForcedVariableKind } = vi.hoisted(() => ({
  mockVarLabel: vi.fn(),
  mockIsExceptionVariable: vi.fn<(variable: string, nodeType?: BlockEnum) => boolean>(() => false),
  mockForcedVariableKind: { value: '' as '' | 'env' | 'conversation' | 'rag' },
}))

vi.mock('@lexical/react/LexicalComposerContext')
vi.mock('@lexical/utils')
vi.mock('reactflow')
vi.mock('../../hooks')
vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()
  return {
    ...actual,
    isExceptionVariable: mockIsExceptionVariable,
  }
})
vi.mock('@/app/components/workflow/nodes/_base/components/variable/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/nodes/_base/components/variable/utils')>()
  return {
    ...actual,
    isENV: (valueSelector: ValueSelector) => {
      if (mockForcedVariableKind.value === 'env')
        return true
      return actual.isENV(valueSelector)
    },
    isConversationVar: (valueSelector: ValueSelector) => {
      if (mockForcedVariableKind.value === 'conversation')
        return true
      return actual.isConversationVar(valueSelector)
    },
    isRagVariableVar: (valueSelector: ValueSelector) => {
      if (mockForcedVariableKind.value === 'rag')
        return true
      return actual.isRagVariableVar(valueSelector)
    },
  }
})
vi.mock('@/app/components/workflow/nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInEditor: (props: {
    onClick: (e: React.MouseEvent) => void
    errorMsg?: string
    nodeTitle?: string
    nodeType?: BlockEnum
    notShowFullPath?: boolean
  }) => {
    mockVarLabel(props)
    return (
      <button type="button" onClick={props.onClick}>
        label
      </button>
    )
  },
}))
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-full-path-panel', () => ({
  default: (props: {
    nodeName: string
    path: string[]
    varType: Type
    nodeType?: BlockEnum
  }) => <div data-testid="var-full-path-panel">{props.nodeName}</div>,
}))

const mockRegisterCommand = vi.fn()
const mockHasNodes = vi.fn()
const mockSetViewport = vi.fn()
const mockGetState = vi.fn()

const mockEditor = {
  registerCommand: mockRegisterCommand,
  hasNodes: mockHasNodes,
} as unknown as LexicalEditor

describe('WorkflowVariableBlockComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockForcedVariableKind.value = ''
    mockHasNodes.mockReturnValue(true)
    mockRegisterCommand.mockReturnValue(vi.fn())
    mockGetState.mockReturnValue({ transform: [0, 0, 2] })

    vi.mocked(useLexicalComposerContext).mockReturnValue([
      mockEditor,
      {},
    ] as unknown as ReturnType<typeof useLexicalComposerContext>)
    vi.mocked(mergeRegister).mockImplementation((...cleanups) => () => cleanups.forEach(cleanup => cleanup()))
    vi.mocked(useSelectOrDelete).mockReturnValue([{ current: null }, false])
    vi.mocked(useReactFlow).mockReturnValue({
      setViewport: mockSetViewport,
    } as unknown as ReturnType<typeof useReactFlow>)
    vi.mocked(useStoreApi).mockReturnValue({
      getState: mockGetState,
    } as unknown as ReturnType<typeof useStoreApi>)
  })

  it('should throw when WorkflowVariableBlockNode is not registered', () => {
    mockHasNodes.mockReturnValue(false)

    expect(() => render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['node-1', 'output']}
        workflowNodesMap={{}}
      />,
    )).toThrow('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')
  })

  it('should render variable label and register update command', () => {
    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['node-1', 'output']}
        workflowNodesMap={{}}
      />,
    )

    expect(screen.getByRole('button', { name: 'label' })).toBeInTheDocument()
    expect(mockHasNodes).toHaveBeenCalledWith([WorkflowVariableBlockNode])
    expect(mockRegisterCommand).toHaveBeenCalledWith(
      UPDATE_WORKFLOW_NODES_MAP,
      expect.any(Function),
      expect.any(Number),
    )
  })

  it('should call setViewport when label is clicked and node exists', async () => {
    const user = userEvent.setup()
    const workflowContainer = document.createElement('div')
    workflowContainer.id = 'workflow-container'
    Object.defineProperty(workflowContainer, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(workflowContainer, 'clientHeight', { value: 800, configurable: true })
    document.body.appendChild(workflowContainer)

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['node-1', 'group', 'field']}
        workflowNodesMap={{
          'node-1': {
            title: 'Node A',
            type: BlockEnum.LLM,
            width: 200,
            height: 100,
            position: { x: 50, y: 80 },
          },
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'label' }))

    expect(mockSetViewport).toHaveBeenCalledWith({
      x: (1000 - 400 - 200 * 2) / 2 - 50 * 2,
      y: (800 - 100 * 2) / 2 - 80 * 2,
      zoom: 2,
    })
  })

  it('should render safely when node exists and getVarType is not provided', () => {
    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['node-1', 'group', 'field']}
        workflowNodesMap={{
          'node-1': {
            title: 'Node A',
            type: BlockEnum.LLM,
            width: 200,
            height: 100,
            position: { x: 0, y: 0 },
          },
        }}
      />,
    )

    expect(screen.getByRole('button', { name: 'label' })).toBeInTheDocument()
  })

  it('should pass computed varType when getVarType is provided', () => {
    const getVarType = vi.fn(() => Type.number)

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['node-1', 'group', 'field']}
        workflowNodesMap={{
          'node-1': {
            title: 'Node A',
            type: BlockEnum.LLM,
            width: 200,
            height: 100,
            position: { x: 0, y: 0 },
          },
        }}
        getVarType={getVarType}
      />,
    )

    expect(getVarType).toHaveBeenCalledWith({
      nodeId: 'node-1',
      valueSelector: ['node-1', 'group', 'field'] as ValueSelector,
    })
  })

  it('should mark env variable invalid when not found in environmentVariables', () => {
    const environmentVariables: Var[] = [{ variable: 'env.valid_key', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['env', 'missing_key']}
        workflowNodesMap={{}}
        environmentVariables={environmentVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: expect.any(String),
    }))
  })

  it('should keep env variable valid when environmentVariables is omitted', () => {
    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['env', 'missing_key']}
        workflowNodesMap={{}}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should treat env variable as valid when it exists in environmentVariables', () => {
    const environmentVariables: Var[] = [{ variable: 'env.valid_key', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['env', 'valid_key']}
        workflowNodesMap={{}}
        environmentVariables={environmentVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should handle env selector with missing segment when environmentVariables are provided', () => {
    const environmentVariables: Var[] = [{ variable: 'env.', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['env']}
        workflowNodesMap={{}}
        environmentVariables={environmentVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should evaluate env fallback selector tokens when classifier is forced', () => {
    mockForcedVariableKind.value = 'env'
    const environmentVariables: Var[] = [{ variable: '.', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={[]}
        workflowNodesMap={{}}
        environmentVariables={environmentVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should treat conversation variable as valid when found in conversationVariables', () => {
    const conversationVariables: Var[] = [{ variable: 'conversation.topic', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['conversation', 'topic']}
        workflowNodesMap={{}}
        conversationVariables={conversationVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should keep conversation variable valid when conversationVariables is omitted', () => {
    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['conversation', 'topic']}
        workflowNodesMap={{}}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should mark conversation variable invalid when not found in conversationVariables', () => {
    const conversationVariables: Var[] = [{ variable: 'conversation.other', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['conversation', 'topic']}
        workflowNodesMap={{}}
        conversationVariables={conversationVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: expect.any(String),
    }))
  })

  it('should handle conversation selector with missing segment when conversationVariables are provided', () => {
    const conversationVariables: Var[] = [{ variable: 'conversation.', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['conversation']}
        workflowNodesMap={{}}
        conversationVariables={conversationVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should evaluate conversation fallback selector tokens when classifier is forced', () => {
    mockForcedVariableKind.value = 'conversation'
    const conversationVariables: Var[] = [{ variable: '.', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={[]}
        workflowNodesMap={{}}
        conversationVariables={conversationVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should treat global variable as valid without node', () => {
    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['sys', 'user_id']}
        workflowNodesMap={{}}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should use rag variable validation path', () => {
    const ragVariables: Var[] = [{ variable: 'rag.shared.answer', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['rag', 'shared', 'answer']}
        workflowNodesMap={{ rag: { title: 'Rag', type: BlockEnum.Tool } as never }}
        ragVariables={ragVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should keep rag variable valid when ragVariables is omitted', () => {
    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['rag', 'shared', 'answer']}
        workflowNodesMap={{ rag: { title: 'Rag', type: BlockEnum.Tool } as never }}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should mark rag variable invalid when not found in ragVariables', () => {
    const ragVariables: Var[] = [{ variable: 'rag.shared.other', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['rag', 'shared', 'answer']}
        workflowNodesMap={{ rag: { title: 'Rag', type: BlockEnum.Tool } as never }}
        ragVariables={ragVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: expect.any(String),
    }))
  })

  it('should handle rag selector with missing segment when ragVariables are provided', () => {
    const ragVariables: Var[] = [{ variable: 'rag.shared.', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['rag', 'shared']}
        workflowNodesMap={{ shared: { title: 'Rag', type: BlockEnum.Tool } as never }}
        ragVariables={ragVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should evaluate rag fallback selector tokens when classifier is forced', () => {
    mockForcedVariableKind.value = 'rag'
    const ragVariables: Var[] = [{ variable: '..', type: VarType.string }]

    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={[]}
        workflowNodesMap={{}}
        ragVariables={ragVariables}
      />,
    )

    expect(mockVarLabel).toHaveBeenCalledWith(expect.objectContaining({
      errorMsg: undefined,
    }))
  })

  it('should apply workflow node map updates through command handler', () => {
    render(
      <WorkflowVariableBlockComponent
        nodeKey="k"
        variables={['node-1', 'field']}
        workflowNodesMap={{}}
      />,
    )

    const updateHandler = mockRegisterCommand.mock.calls[0][1] as (map: Record<string, unknown>) => boolean
    let result = false
    act(() => {
      result = updateHandler({
        'node-1': {
          title: 'Updated',
          type: BlockEnum.LLM,
          width: 100,
          height: 50,
          position: { x: 0, y: 0 },
        },
      })
    })

    expect(result).toBe(true)
  })
})
