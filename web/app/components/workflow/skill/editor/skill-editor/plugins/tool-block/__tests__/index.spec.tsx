import { render } from '@testing-library/react'

import {
  DELETE_TOOL_BLOCK_COMMAND,
  INSERT_TOOL_BLOCK_COMMAND,
} from '../commands'
import {
  ToolBlock,
} from '../index'

const mockInsertNodes = vi.hoisted(() => vi.fn())
const mockCreateToolBlockNode = vi.hoisted(() => vi.fn((payload: unknown) => ({ kind: 'tool-block-node', payload })))
const mockRegisterCommand = vi.hoisted(() => vi.fn())
const mockEditor = vi.hoisted(() => ({
  hasNodes: vi.fn(() => true),
  registerCommand: mockRegisterCommand,
}))
const unregisterFns = vi.hoisted(() => [vi.fn(), vi.fn()])

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}))

vi.mock('@lexical/utils', () => ({
  mergeRegister: (...callbacks: Array<() => void>) => () => callbacks.forEach(callback => callback()),
}))

vi.mock('lexical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lexical')>()
  return {
    ...actual,
    $insertNodes: mockInsertNodes,
    COMMAND_PRIORITY_EDITOR: 100,
  }
})

vi.mock('../node', () => ({
  ToolBlockNode: class MockToolBlockNode {},
  $createToolBlockNode: mockCreateToolBlockNode,
}))

describe('ToolBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEditor.hasNodes.mockReturnValue(true)
    mockRegisterCommand
      .mockReturnValueOnce(unregisterFns[0])
      .mockReturnValueOnce(unregisterFns[1])
  })

  it('should register insert and delete handlers with the editor', () => {
    render(<ToolBlock />)

    expect(mockEditor.hasNodes).toHaveBeenCalled()
    expect(mockRegisterCommand).toHaveBeenNthCalledWith(
      1,
      INSERT_TOOL_BLOCK_COMMAND,
      expect.any(Function),
      100,
    )
    expect(mockRegisterCommand).toHaveBeenNthCalledWith(
      2,
      DELETE_TOOL_BLOCK_COMMAND,
      expect.any(Function),
      100,
    )
  })

  it('should create and insert a tool block node when the insert handler runs', () => {
    render(<ToolBlock />)

    const insertHandler = mockRegisterCommand.mock.calls[0][1] as (payload: unknown) => boolean
    const payload = {
      provider: 'openai/tools',
      tool: 'search',
      configId: '11111111-1111-4111-8111-111111111111',
    }

    expect(insertHandler(payload)).toBe(true)
    expect(mockCreateToolBlockNode).toHaveBeenCalledWith(payload)
    expect(mockInsertNodes).toHaveBeenCalledWith([
      { kind: 'tool-block-node', payload },
    ])
  })

  it('should return true from the delete handler', () => {
    render(<ToolBlock />)

    const deleteHandler = mockRegisterCommand.mock.calls[1][1] as () => boolean

    expect(deleteHandler()).toBe(true)
  })

  it('should unregister command handlers on unmount', () => {
    const { unmount } = render(<ToolBlock />)

    unmount()

    expect(unregisterFns[0]).toHaveBeenCalledTimes(1)
    expect(unregisterFns[1]).toHaveBeenCalledTimes(1)
  })

  it('should throw when the tool block node is not registered', () => {
    mockEditor.hasNodes.mockReturnValue(false)

    expect(() => render(<ToolBlock />)).toThrow('ToolBlockPlugin: ToolBlockNode not registered on editor')
  })
})
