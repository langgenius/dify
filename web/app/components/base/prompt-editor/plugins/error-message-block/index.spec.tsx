import type { LexicalEditor } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
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

vi.mock('@lexical/react/LexicalComposerContext')
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

describe('ErrorMessageBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodes.mockReturnValue(true)
    mockRegisterCommand.mockReturnValue(vi.fn())
    vi.mocked(useLexicalComposerContext).mockReturnValue([
      mockEditor,
      {},
    ] as unknown as ReturnType<typeof useLexicalComposerContext>)
    vi.mocked(mergeRegister).mockImplementation((...cleanups) => {
      return () => cleanups.forEach(cleanup => cleanup())
    })
    vi.mocked($createErrorMessageBlockNode).mockReturnValue({ id: 'node' } as unknown as ErrorMessageBlockNode)
  })

  it('should render null and register insert and delete commands', () => {
    const { container } = render(<ErrorMessageBlock />)

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

    expect(() => render(<ErrorMessageBlock />)).toThrow(
      'ERROR_MESSAGEBlockPlugin: ERROR_MESSAGEBlock not registered on editor',
    )
  })

  it('should insert created node and call onInsert when insert command handler runs', () => {
    const onInsert = vi.fn()
    render(<ErrorMessageBlock onInsert={onInsert} />)

    const insertHandler = mockRegisterCommand.mock.calls[0][1] as () => boolean
    const result = insertHandler()

    expect($createErrorMessageBlockNode).toHaveBeenCalledTimes(1)
    expect($insertNodes).toHaveBeenCalledWith([{ id: 'node' }])
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it('should return true on insert command without onInsert callback', () => {
    render(<ErrorMessageBlock />)

    const insertHandler = mockRegisterCommand.mock.calls[0][1] as () => boolean

    expect(insertHandler()).toBe(true)
    expect($insertNodes).toHaveBeenCalled()
  })

  it('should call onDelete and return true when delete command handler runs', () => {
    const onDelete = vi.fn()
    render(<ErrorMessageBlock onDelete={onDelete} />)

    const deleteHandler = mockRegisterCommand.mock.calls[1][1] as () => boolean
    const result = deleteHandler()

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it('should return true on delete command without onDelete callback', () => {
    render(<ErrorMessageBlock />)

    const deleteHandler = mockRegisterCommand.mock.calls[1][1] as () => boolean

    expect(deleteHandler()).toBe(true)
  })

  it('should run merged cleanup on unmount', () => {
    const insertCleanup = vi.fn()
    const deleteCleanup = vi.fn()
    mockRegisterCommand
      .mockReturnValueOnce(insertCleanup)
      .mockReturnValueOnce(deleteCleanup)

    const { unmount } = render(<ErrorMessageBlock />)
    unmount()

    expect(insertCleanup).toHaveBeenCalledTimes(1)
    expect(deleteCleanup).toHaveBeenCalledTimes(1)
  })
})
