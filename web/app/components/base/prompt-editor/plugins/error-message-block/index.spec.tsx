import type { LexicalComposerContextWithEditor } from '@lexical/react/LexicalComposerContext'
import type { LexicalEditor } from 'lexical'
import type { ReactElement } from 'react'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { render } from '@testing-library/react'
import { $insertNodes, COMMAND_PRIORITY_EDITOR } from 'lexical'
import {
  DELETE_ERROR_MESSAGE_COMMAND,
  ErrorMessageBlock,
  ErrorMessageBlockNode,
  INSERT_ERROR_MESSAGE_BLOCK_COMMAND,
} from './index'
import { $createErrorMessageBlockNode } from './node'

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

const mockEditor = {
  hasNodes: mockHasNodes,
  registerCommand: mockRegisterCommand,
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

describe('ErrorMessageBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodes.mockReturnValue(true)
    mockRegisterCommand.mockReturnValue(vi.fn())
    vi.mocked(mergeRegister).mockImplementation((...cleanups) => {
      return () => cleanups.forEach(cleanup => cleanup())
    })
    vi.mocked($createErrorMessageBlockNode).mockReturnValue({ id: 'node' } as unknown as ErrorMessageBlockNode)
  })

  it('should render null and register insert and delete commands', () => {
    const { container } = renderWithLexicalContext(<ErrorMessageBlock />)

    expect(container.firstChild).toBeNull()
    expect(mockHasNodes).toHaveBeenCalledWith([ErrorMessageBlockNode])
    expect(mockRegisterCommand).toHaveBeenCalledTimes(2)
    expect(mockRegisterCommand).toHaveBeenNthCalledWith(
      1,
      INSERT_ERROR_MESSAGE_BLOCK_COMMAND,
      expect.any(Function),
      COMMAND_PRIORITY_EDITOR,
    )
    expect(mockRegisterCommand).toHaveBeenNthCalledWith(
      2,
      DELETE_ERROR_MESSAGE_COMMAND,
      expect.any(Function),
      COMMAND_PRIORITY_EDITOR,
    )
    expect(ErrorMessageBlock.displayName).toBe('ErrorMessageBlock')
  })

  it('should throw when ErrorMessageBlockNode is not registered', () => {
    mockHasNodes.mockReturnValue(false)

    expect(() => renderWithLexicalContext(<ErrorMessageBlock />)).toThrow(
      'ERROR_MESSAGEBlockPlugin: ERROR_MESSAGEBlock not registered on editor',
    )
  })

  it('should insert created node and call onInsert when insert command handler runs', () => {
    const onInsert = vi.fn()
    renderWithLexicalContext(<ErrorMessageBlock onInsert={onInsert} />)

    const insertHandler = mockRegisterCommand.mock.calls[0][1] as () => boolean
    const result = insertHandler()

    expect($createErrorMessageBlockNode).toHaveBeenCalledTimes(1)
    expect($insertNodes).toHaveBeenCalledWith([{ id: 'node' }])
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it('should return true on insert command without onInsert callback', () => {
    renderWithLexicalContext(<ErrorMessageBlock />)

    const insertHandler = mockRegisterCommand.mock.calls[0][1] as () => boolean

    expect(insertHandler()).toBe(true)
    expect($insertNodes).toHaveBeenCalled()
  })

  it('should call onDelete and return true when delete command handler runs', () => {
    const onDelete = vi.fn()
    renderWithLexicalContext(<ErrorMessageBlock onDelete={onDelete} />)

    const deleteHandler = mockRegisterCommand.mock.calls[1][1] as () => boolean
    const result = deleteHandler()

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it('should return true on delete command without onDelete callback', () => {
    renderWithLexicalContext(<ErrorMessageBlock />)

    const deleteHandler = mockRegisterCommand.mock.calls[1][1] as () => boolean

    expect(deleteHandler()).toBe(true)
  })

  it('should run merged cleanup on unmount', () => {
    const insertCleanup = vi.fn()
    const deleteCleanup = vi.fn()
    mockRegisterCommand
      .mockReturnValueOnce(insertCleanup)
      .mockReturnValueOnce(deleteCleanup)

    const { unmount } = renderWithLexicalContext(<ErrorMessageBlock />)
    unmount()

    expect(insertCleanup).toHaveBeenCalledTimes(1)
    expect(deleteCleanup).toHaveBeenCalledTimes(1)
  })
})
