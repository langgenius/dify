import type { LexicalComposerContextWithEditor } from '@lexical/react/LexicalComposerContext'
import type { EntityMatch } from '@lexical/text'
import type { LexicalEditor, LexicalNode } from 'lexical'
import type { ReactElement } from 'react'
import type { WorkflowNodesMap } from './node'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { render } from '@testing-library/react'
import { $applyNodeReplacement } from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import { WorkflowVariableBlockNode } from './index'
import { $createWorkflowVariableBlockNode } from './node'
import WorkflowVariableBlockReplacementBlock from './workflow-variable-block-replacement-block'

vi.mock('@lexical/utils')
vi.mock('lexical')
vi.mock('../../utils')
vi.mock('./node')

const mockHasNodes = vi.fn()
const mockRegisterNodeTransform = vi.fn()

const mockEditor = {
  hasNodes: mockHasNodes,
  registerNodeTransform: mockRegisterNodeTransform,
} as unknown as LexicalEditor

const lexicalContextValue: LexicalComposerContextWithEditor = [
  mockEditor,
  { getTheme: () => undefined },
]

const renderWithLexicalContext = (ui: ReactElement) => {
  return render(
    <LexicalComposerContext.Provider value={lexicalContextValue}>
      {ui}
    </LexicalComposerContext.Provider>,
  )
}

describe('WorkflowVariableBlockReplacementBlock', () => {
  const variables: NodeOutPutVar[] = [
    {
      nodeId: 'env',
      title: 'ENV',
      vars: [{ variable: 'env.key', type: VarType.string }],
    },
    {
      nodeId: 'conversation',
      title: 'Conversation',
      vars: [{ variable: 'conversation.topic', type: VarType.string }],
    },
    {
      nodeId: 'node-1',
      title: 'Node A',
      vars: [
        { variable: 'output', type: VarType.string },
        { variable: 'ragVarA', type: VarType.string, isRagVariable: true },
      ],
    },
    {
      nodeId: 'rag',
      title: 'RAG',
      vars: [{ variable: 'rag.shared.answer', type: VarType.string, isRagVariable: true }],
    },
  ]

  const workflowNodesMap: WorkflowNodesMap = {
    'node-1': {
      title: 'Node A',
      type: BlockEnum.LLM,
      width: 200,
      height: 100,
      position: { x: 20, y: 40 },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodes.mockReturnValue(true)
    mockRegisterNodeTransform.mockReturnValue(vi.fn())
    vi.mocked(mergeRegister).mockImplementation((...cleanups) => () => cleanups.forEach(cleanup => cleanup()))
    vi.mocked($createWorkflowVariableBlockNode).mockReturnValue({ type: 'workflow-node' } as unknown as WorkflowVariableBlockNode)
    vi.mocked($applyNodeReplacement).mockImplementation((node: LexicalNode) => node)
  })

  it('should register transform and cleanup on unmount', () => {
    const transformCleanup = vi.fn()
    mockRegisterNodeTransform.mockReturnValue(transformCleanup)

    const { unmount, container } = renderWithLexicalContext(
      <WorkflowVariableBlockReplacementBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )

    expect(container.firstChild).toBeNull()
    expect(mockHasNodes).toHaveBeenCalledWith([WorkflowVariableBlockNode])
    expect(mockRegisterNodeTransform).toHaveBeenCalledWith(CustomTextNode, expect.any(Function))

    unmount()
    expect(transformCleanup).toHaveBeenCalledTimes(1)
  })

  it('should throw when WorkflowVariableBlockNode is not registered', () => {
    mockHasNodes.mockReturnValue(false)

    expect(() => renderWithLexicalContext(
      <WorkflowVariableBlockReplacementBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )).toThrow('WorkflowVariableBlockNodePlugin: WorkflowVariableBlockNode not registered on editor')
  })

  it('should pass matcher and creator to decoratorTransform', () => {
    renderWithLexicalContext(
      <WorkflowVariableBlockReplacementBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )

    const transformCallback = mockRegisterNodeTransform.mock.calls[0][1] as (node: LexicalNode) => void
    const textNode = { id: 'text-node' } as unknown as LexicalNode
    transformCallback(textNode)

    expect(decoratorTransform).toHaveBeenCalledWith(
      textNode,
      expect.any(Function),
      expect.any(Function),
    )
  })

  it('should match variable placeholders and return null for non-placeholder text', () => {
    renderWithLexicalContext(
      <WorkflowVariableBlockReplacementBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )

    const transformCallback = mockRegisterNodeTransform.mock.calls[0][1] as (node: LexicalNode) => void
    transformCallback({ id: 'text-node' } as unknown as LexicalNode)

    const getMatch = vi.mocked(decoratorTransform).mock.calls[0][1] as (text: string) => EntityMatch | null
    const match = getMatch('prefix {{#node-1.output#}} suffix')

    expect(match).toEqual({
      start: 7,
      end: 26,
    })
    expect(getMatch('plain text only')).toBeNull()
  })

  it('should create replacement node with mapped env/conversation/rag vars and call onInsert', () => {
    const onInsert = vi.fn()
    const getVarType = vi.fn(() => Type.string)

    renderWithLexicalContext(
      <WorkflowVariableBlockReplacementBlock
        workflowNodesMap={workflowNodesMap}
        onInsert={onInsert}
        getVarType={getVarType}
        variables={variables}
      />,
    )

    const transformCallback = mockRegisterNodeTransform.mock.calls[0][1] as (node: LexicalNode) => void
    transformCallback({ id: 'text-node' } as unknown as LexicalNode)

    const createNode = vi.mocked(decoratorTransform).mock.calls[0][2] as (
      textNode: { getTextContent: () => string },
    ) => WorkflowVariableBlockNode

    const created = createNode({
      getTextContent: () => '{{#node-1.output#}}',
    })

    expect(onInsert).toHaveBeenCalledTimes(1)
    expect($createWorkflowVariableBlockNode).toHaveBeenCalledWith(
      ['node-1', 'output'],
      workflowNodesMap,
      getVarType,
      variables[0].vars,
      variables[1].vars,
      [
        { variable: 'ragVarA', type: VarType.string, isRagVariable: true },
        { variable: 'rag.shared.answer', type: VarType.string, isRagVariable: true },
      ],
    )
    expect($applyNodeReplacement).toHaveBeenCalledWith({ type: 'workflow-node' })
    expect(created).toEqual({ type: 'workflow-node' })
  })

  it('should create replacement node without optional callbacks and variable groups', () => {
    renderWithLexicalContext(
      <WorkflowVariableBlockReplacementBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )

    const transformCallback = mockRegisterNodeTransform.mock.calls[0][1] as (node: LexicalNode) => void
    transformCallback({ id: 'text-node' } as unknown as LexicalNode)

    const createNode = vi.mocked(decoratorTransform).mock.calls[0][2] as (
      textNode: { getTextContent: () => string },
    ) => WorkflowVariableBlockNode

    expect(() => createNode({ getTextContent: () => '{{#node-1.output#}}' })).not.toThrow()
    expect($createWorkflowVariableBlockNode).toHaveBeenCalledWith(
      ['node-1', 'output'],
      workflowNodesMap,
      undefined,
      [],
      [],
      undefined,
    )
  })
})
