import type { LexicalCommand, LexicalEditor } from 'lexical'
import type { Dataset } from './index'
import { render } from '@testing-library/react'
import { COMMAND_PRIORITY_EDITOR } from 'lexical'
import { ContextBlock, DELETE_CONTEXT_BLOCK_COMMAND, INSERT_CONTEXT_BLOCK_COMMAND } from './index'

type CommandHandler<T = unknown> = (payload?: T, editor?: LexicalEditor) => boolean
type RegisteredCall = [LexicalCommand<unknown>, CommandHandler, number]

// Mock Lexical editor
const mockUnregister = vi.fn()
const mockRegisterCommand = vi.fn((_command: LexicalCommand<unknown>, _handler: CommandHandler, _priority: number) => {
  return mockUnregister
})
const mockHasNodes = vi.fn((_nodes: unknown[]) => true)

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [{
    hasNodes: mockHasNodes,
    registerCommand: mockRegisterCommand,
  }],
}))

// Mock mergeRegister to collect and return cleanup fns
vi.mock('@lexical/utils', () => ({
  mergeRegister: (...fns: (() => void)[]) => {
    return () => fns.forEach(fn => fn())
  },
}))

// Mock $insertNodes
const mockInsertNodes = vi.fn()
vi.mock('lexical', async () => {
  const actual = await vi.importActual<typeof import('lexical')>('lexical')
  return {
    ...actual,
    $insertNodes: (nodes: unknown[]) => mockInsertNodes(nodes),
  }
})

// Mock node module
const mockCreateContextBlockNode = vi.fn((
  _datasets: Dataset[],
  _onAddContext: () => void,
  _canNotAddContext?: boolean,
) => {
  return { __type: 'MockContextBlockNode' }
})
vi.mock('./node', () => {
  const MockContextBlockNodeClass = class { }
  return {
    ContextBlockNode: MockContextBlockNodeClass,
    $createContextBlockNode: (
      datasets: Dataset[],
      onAddContext: () => void,
      canNotAddContext?: boolean,
    ) => mockCreateContextBlockNode(datasets, onAddContext, canNotAddContext),
  }
})

describe('ContextBlock', () => {
  const getCommandHandler = (command: LexicalCommand<unknown>) => {
    const commandCall = mockRegisterCommand.mock.calls.find(
      ([registeredCommand]) => registeredCommand === command,
    ) as RegisteredCall | undefined
    if (!commandCall)
      throw new Error(`Expected command registration for ${String(command.type)}`)
    return commandCall[1]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodes.mockReturnValue(true)
  })

  describe('Rendering', () => {
    it('should render (no visible output)', () => {
      const { container } = render(<ContextBlock />)
      expect(container.childElementCount).toBe(0)
    })
  })

  describe('Editor Node Registration Check', () => {
    it('should check that ContextBlockNode is registered on the editor', () => {
      render(<ContextBlock />)
      expect(mockHasNodes).toHaveBeenCalledTimes(1)
      const arg = mockHasNodes.mock.calls[0][0]
      expect(Array.isArray(arg)).toBe(true)
      expect(arg).toHaveLength(1)
    })

    it('should throw when ContextBlockNode is not registered', () => {
      mockHasNodes.mockReturnValue(false)
      expect(() => {
        render(<ContextBlock />)
      }).toThrow('ContextBlockPlugin: ContextBlock not registered on editor')
    })
  })

  describe('Command Registration', () => {
    it('should register two commands on mount', () => {
      render(<ContextBlock />)
      expect(mockRegisterCommand).toHaveBeenCalledTimes(2)
    })

    it('should register INSERT_CONTEXT_BLOCK_COMMAND with COMMAND_PRIORITY_EDITOR', () => {
      render(<ContextBlock />)
      expect(mockRegisterCommand).toHaveBeenCalledWith(
        INSERT_CONTEXT_BLOCK_COMMAND,
        expect.any(Function),
        COMMAND_PRIORITY_EDITOR,
      )
    })

    it('should register DELETE_CONTEXT_BLOCK_COMMAND with COMMAND_PRIORITY_EDITOR', () => {
      render(<ContextBlock />)
      expect(mockRegisterCommand).toHaveBeenCalledWith(
        DELETE_CONTEXT_BLOCK_COMMAND,
        expect.any(Function),
        COMMAND_PRIORITY_EDITOR,
      )
    })
  })

  describe('INSERT_CONTEXT_BLOCK_COMMAND handler', () => {
    const getInsertHandler = () => {
      render(<ContextBlock />)
      return getCommandHandler(INSERT_CONTEXT_BLOCK_COMMAND)
    }

    it('should create a context block node with default props', () => {
      const handler = getInsertHandler()
      handler()
      expect(mockCreateContextBlockNode).toHaveBeenCalledWith([], expect.any(Function), undefined)
    })

    it('should insert the created node using $insertNodes', () => {
      const handler = getInsertHandler()
      handler()
      expect(mockInsertNodes).toHaveBeenCalledTimes(1)
      expect(mockInsertNodes).toHaveBeenCalledWith([{ __type: 'MockContextBlockNode' }])
    })

    it('should return true', () => {
      const handler = getInsertHandler()
      const result = handler()
      expect(result).toBe(true)
    })

    it('should call onInsert when provided', () => {
      const onInsert = vi.fn()
      render(<ContextBlock onInsert={onInsert} />)
      const handler = getCommandHandler(INSERT_CONTEXT_BLOCK_COMMAND)
      handler()
      expect(onInsert).toHaveBeenCalledTimes(1)
    })

    it('should not throw when onInsert is not provided', () => {
      const handler = getInsertHandler()
      expect(() => handler()).not.toThrow()
    })

    it('should pass datasets to $createContextBlockNode', () => {
      const datasets: Dataset[] = [{ id: '1', name: 'Test', type: 'text' }]
      render(<ContextBlock datasets={datasets} />)
      const handler = getCommandHandler(INSERT_CONTEXT_BLOCK_COMMAND)
      handler()
      expect(mockCreateContextBlockNode).toHaveBeenCalledWith(datasets, expect.any(Function), undefined)
    })

    it('should pass canNotAddContext to $createContextBlockNode', () => {
      render(<ContextBlock canNotAddContext={true} />)
      const handler = getCommandHandler(INSERT_CONTEXT_BLOCK_COMMAND)
      handler()
      expect(mockCreateContextBlockNode).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        true,
      )
    })
  })

  describe('DELETE_CONTEXT_BLOCK_COMMAND handler', () => {
    const getDeleteHandler = () => {
      render(<ContextBlock />)
      return getCommandHandler(DELETE_CONTEXT_BLOCK_COMMAND)
    }

    it('should return true', () => {
      const handler = getDeleteHandler()
      const result = handler()
      expect(result).toBe(true)
    })

    it('should call onDelete when provided', () => {
      const onDelete = vi.fn()
      render(<ContextBlock onDelete={onDelete} />)
      const handler = getCommandHandler(DELETE_CONTEXT_BLOCK_COMMAND)
      handler()
      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should not throw when onDelete is not provided', () => {
      const handler = getDeleteHandler()
      expect(() => handler()).not.toThrow()
    })
  })

  describe('Props Defaults', () => {
    it('should default datasets to empty array', () => {
      render(<ContextBlock />)
      const handler = getCommandHandler(INSERT_CONTEXT_BLOCK_COMMAND)
      handler()
      expect(mockCreateContextBlockNode.mock.calls[0][0]).toEqual([])
    })

    it('should default onAddContext to noop', () => {
      render(<ContextBlock />)
      const handler = getCommandHandler(INSERT_CONTEXT_BLOCK_COMMAND)
      handler()
      const onAddContextArg = mockCreateContextBlockNode.mock.calls[0][1]
      expect(typeof onAddContextArg).toBe('function')
      expect(() => onAddContextArg()).not.toThrow()
    })
  })

  describe('Exports', () => {
    it('should export INSERT_CONTEXT_BLOCK_COMMAND', () => {
      expect(INSERT_CONTEXT_BLOCK_COMMAND).toBeDefined()
    })

    it('should export DELETE_CONTEXT_BLOCK_COMMAND', () => {
      expect(DELETE_CONTEXT_BLOCK_COMMAND).toBeDefined()
    })

    it('should export ContextBlock component', () => {
      expect(ContextBlock).toBeDefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined datasets prop', () => {
      expect(() => {
        render(<ContextBlock datasets={undefined} />)
      }).not.toThrow()
    })

    it('should handle empty datasets array', () => {
      expect(() => {
        render(<ContextBlock datasets={[]} />)
      }).not.toThrow()
    })
  })
})
