import type { LexicalComposerContextWithEditor } from '@lexical/react/LexicalComposerContext'
import type { LexicalEditor } from 'lexical'
import type { ReactElement } from 'react'
import type { WorkflowNodesMap } from './node'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { render } from '@testing-library/react'
import { $insertNodes, COMMAND_PRIORITY_EDITOR } from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  CLEAR_HIDE_MENU_TIMEOUT,
  DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND,
  INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND,
  UPDATE_WORKFLOW_NODES_MAP,
  WorkflowVariableBlock,
  WorkflowVariableBlockNode,
} from './index'
import { $createWorkflowVariableBlockNode } from './node'

vi.mock('@lexical/utils')
vi.mock('lexical', async () => {
  const actual = await vi.importActual('lexical')
  return {
    ...actual,
    $insertNodes: vi.fn(),
    createCommand: vi.fn(name => name),
    COMMAND_PRIORITY_EDITOR: 1,
  }
})
vi.mock('./node')

const mockHasNodes = vi.fn()
const mockRegisterCommand = vi.fn()
const mockDispatchCommand = vi.fn()
const mockUpdate = vi.fn((callback: () => void) => callback())

const mockEditor = {
  hasNodes: mockHasNodes,
  registerCommand: mockRegisterCommand,
  dispatchCommand: mockDispatchCommand,
  update: mockUpdate,
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

describe('WorkflowVariableBlock', () => {
  const workflowNodesMap: WorkflowNodesMap = {
    'node-1': {
      title: 'Node A',
      type: BlockEnum.LLM,
      width: 200,
      height: 100,
      position: { x: 10, y: 20 },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodes.mockReturnValue(true)
    mockRegisterCommand.mockReturnValue(vi.fn())
    vi.mocked(mergeRegister).mockImplementation((...cleanups) => () => cleanups.forEach(cleanup => cleanup()))
    vi.mocked($createWorkflowVariableBlockNode).mockReturnValue({ id: 'workflow-node' } as unknown as WorkflowVariableBlockNode)
  })

  it('should render null and register insert/delete commands', () => {
    const { container } = renderWithLexicalContext(
      <WorkflowVariableBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )

    expect(container.firstChild).toBeNull()
    expect(mockHasNodes).toHaveBeenCalledWith([WorkflowVariableBlockNode])
    expect(mockRegisterCommand).toHaveBeenNthCalledWith(
      1,
      INSERT_WORKFLOW_VARIABLE_BLOCK_COMMAND,
      expect.any(Function),
      COMMAND_PRIORITY_EDITOR,
    )
    expect(mockRegisterCommand).toHaveBeenNthCalledWith(
      2,
      DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND,
      expect.any(Function),
      COMMAND_PRIORITY_EDITOR,
    )
    expect(WorkflowVariableBlock.displayName).toBe('WorkflowVariableBlock')
  })

  it('should dispatch workflow node map update on mount', () => {
    renderWithLexicalContext(
      <WorkflowVariableBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )

    expect(mockUpdate).toHaveBeenCalled()
    expect(mockDispatchCommand).toHaveBeenCalledWith(UPDATE_WORKFLOW_NODES_MAP, workflowNodesMap)
  })

  it('should throw when WorkflowVariableBlockNode is not registered', () => {
    mockHasNodes.mockReturnValue(false)

    expect(() => renderWithLexicalContext(
      <WorkflowVariableBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )).toThrow('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')
  })

  it('should insert workflow variable block node and call onInsert', () => {
    const onInsert = vi.fn()
    const getVarType = vi.fn(() => Type.string)

    renderWithLexicalContext(
      <WorkflowVariableBlock
        workflowNodesMap={workflowNodesMap}
        onInsert={onInsert}
        getVarType={getVarType}
      />,
    )

    const insertHandler = mockRegisterCommand.mock.calls[0][1] as (variables: string[]) => boolean
    const result = insertHandler(['node-1', 'answer'])

    expect(mockDispatchCommand).toHaveBeenCalledWith(CLEAR_HIDE_MENU_TIMEOUT, undefined)
    expect($createWorkflowVariableBlockNode).toHaveBeenCalledWith(
      ['node-1', 'answer'],
      workflowNodesMap,
      getVarType,
    )
    expect($insertNodes).toHaveBeenCalledWith([{ id: 'workflow-node' }])
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it('should return true on insert when onInsert is omitted', () => {
    renderWithLexicalContext(
      <WorkflowVariableBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )

    const insertHandler = mockRegisterCommand.mock.calls[0][1] as (variables: string[]) => boolean
    expect(insertHandler(['node-1', 'answer'])).toBe(true)
  })

  it('should call onDelete and return true when delete handler runs', () => {
    const onDelete = vi.fn()

    renderWithLexicalContext(
      <WorkflowVariableBlock
        workflowNodesMap={workflowNodesMap}
        onDelete={onDelete}
      />,
    )

    const deleteHandler = mockRegisterCommand.mock.calls[1][1] as () => boolean
    const result = deleteHandler()

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it('should return true on delete when onDelete is omitted', () => {
    renderWithLexicalContext(
      <WorkflowVariableBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )

    const deleteHandler = mockRegisterCommand.mock.calls[1][1] as () => boolean
    expect(deleteHandler()).toBe(true)
  })

  it('should run merged cleanup on unmount', () => {
    const insertCleanup = vi.fn()
    const deleteCleanup = vi.fn()
    mockRegisterCommand
      .mockReturnValueOnce(insertCleanup)
      .mockReturnValueOnce(deleteCleanup)

    const { unmount } = renderWithLexicalContext(
      <WorkflowVariableBlock
        workflowNodesMap={workflowNodesMap}
      />,
    )
    unmount()

    expect(insertCleanup).toHaveBeenCalledTimes(1)
    expect(deleteCleanup).toHaveBeenCalledTimes(1)
  })
})
