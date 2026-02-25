import type { ThoughtItem } from '../type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Thought from './index'

describe('Thought', () => {
  const createThought = (overrides?: Partial<ThoughtItem>): ThoughtItem => ({
    id: 'test-id',
    tool: 'test-tool',
    tool_input: 'test input',
    observation: 'test output',
    ...overrides,
  } as ThoughtItem)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render single tool thought in collapsed state', () => {
      const thought = createThought()

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText(/used/i)).toBeInTheDocument()
      expect(screen.getByText('test-tool')).toBeInTheDocument()
    })

    it('should render multiple tool thoughts from JSON array', () => {
      const thought = createThought({
        tool: JSON.stringify(['tool1', 'tool2']),
        tool_input: JSON.stringify(['input1', 'input2']),
        observation: JSON.stringify(['output1', 'output2']),
      })

      render(<Thought thought={thought} isFinished={false} />)

      expect(screen.getAllByText(/using/i)).toHaveLength(2)
      expect(screen.getByText('tool1')).toBeInTheDocument()
      expect(screen.getByText('tool2')).toBeInTheDocument()
    })

    it('should show input and output when expanded', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool_input: 'test input data',
        observation: 'test output data',
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.queryByText('test input data')).not.toBeInTheDocument()
      expect(screen.queryByText('test output data')).not.toBeInTheDocument()

      await user.click(screen.getByText(/used/i))

      expect(screen.getByText('test input data')).toBeInTheDocument()
      expect(screen.getByText('test output data')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should show finished state with correct text', () => {
      const thought = createThought()

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText(/used/i)).toBeInTheDocument()
    })

    it('should show in-progress state with correct text', () => {
      const thought = createThought()

      render(<Thought thought={thought} isFinished={false} />)

      expect(screen.getByText(/using/i)).toBeInTheDocument()
    })
  })

  describe('Tool labels', () => {
    it('should use tool name when no labels provided', () => {
      const thought = createThought({
        tool: 'custom-tool',
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('custom-tool')).toBeInTheDocument()
    })

    it('should fallback to tool name when tool_labels is undefined', () => {
      const thought = createThought({
        tool: 'fallback-tool',
        tool_labels: undefined,
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('fallback-tool')).toBeInTheDocument()
    })

    it('should fallback to tool name when toolName property is missing', () => {
      const thought = createThought({
        tool: 'another-tool',
        tool_labels: {},
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('another-tool')).toBeInTheDocument()
    })

    it('should fallback to tool name when language property is missing', () => {
      const thought = createThought({
        tool: 'test-tool',
        tool_labels: {
          toolName: {
            en_US: 'English Label',
            zh_Hans: '中文标签',
          },
        },
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('test-tool')).toBeInTheDocument()
    })

    it('should show knowledge label for dataset tools', () => {
      const thought = createThought({
        tool: 'dataset_123',
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText(/knowledge/i)).toBeInTheDocument()
    })
  })

  describe('Value parsing', () => {
    it('should handle invalid JSON in tool field', () => {
      const thought = createThought({
        tool: 'invalid-json-{',
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('invalid-json-{')).toBeInTheDocument()
    })

    it('should handle non-array JSON in tool field', () => {
      const thought = createThought({
        tool: JSON.stringify({ name: 'object-tool' }),
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('{"name":"object-tool"}')).toBeInTheDocument()
    })

    it('should handle invalid JSON in tool_input when parsing array', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: JSON.stringify(['tool1']),
        tool_input: 'invalid-json-{',
      })

      render(<Thought thought={thought} isFinished={true} />)

      await user.click(screen.getByText(/used/i))

      expect(screen.getByText('invalid-json-{')).toBeInTheDocument()
    })

    it('should handle invalid JSON in observation when parsing array', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: JSON.stringify(['tool1']),
        observation: 'invalid-json-[',
      })

      render(<Thought thought={thought} isFinished={true} />)

      await user.click(screen.getByText(/used/i))

      expect(screen.getByText('invalid-json-[')).toBeInTheDocument()
    })

    it('should extract correct values from JSON arrays by index', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: JSON.stringify(['tool1', 'tool2', 'tool3']),
        tool_input: JSON.stringify(['input1', 'input2', 'input3']),
        observation: JSON.stringify(['output1', 'output2', 'output3']),
      })

      render(<Thought thought={thought} isFinished={true} />)

      const toolSections = screen.getAllByText(/used/i)
      expect(toolSections).toHaveLength(3)

      await user.click(toolSections[0])
      expect(screen.getByText('input1')).toBeInTheDocument()
      expect(screen.getByText('output1')).toBeInTheDocument()

      await user.click(toolSections[1])
      expect(screen.getByText('input2')).toBeInTheDocument()
      expect(screen.getByText('output2')).toBeInTheDocument()

      await user.click(toolSections[2])
      expect(screen.getByText('input3')).toBeInTheDocument()
      expect(screen.getByText('output3')).toBeInTheDocument()
    })

    it('should use original value when isValueArray is false', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: 'single-tool',
        tool_input: 'regular input',
        observation: 'regular output',
      })

      render(<Thought thought={thought} isFinished={true} />)

      await user.click(screen.getByText(/used/i))

      expect(screen.getByText('regular input')).toBeInTheDocument()
      expect(screen.getByText('regular output')).toBeInTheDocument()
    })
  })

  describe('User interactions', () => {
    it('should toggle expand state on click', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool_input: 'test input',
        observation: 'test output',
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.queryByText('test input')).not.toBeInTheDocument()

      await user.click(screen.getByText(/used/i))
      expect(screen.getByText('test input')).toBeInTheDocument()

      await user.click(screen.getByText(/used/i))
      expect(screen.queryByText('test input')).not.toBeInTheDocument()
    })

    it('should expand multiple tools independently', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: JSON.stringify(['tool1', 'tool2']),
        tool_input: JSON.stringify(['input1', 'input2']),
        observation: JSON.stringify(['output1', 'output2']),
      })

      render(<Thought thought={thought} isFinished={true} />)

      const toolHeaders = screen.getAllByText(/used/i)

      await user.click(toolHeaders[0])
      expect(screen.getByText('input1')).toBeInTheDocument()
      expect(screen.queryByText('input2')).not.toBeInTheDocument()

      await user.click(toolHeaders[1])
      expect(screen.getByText('input1')).toBeInTheDocument()
      expect(screen.getByText('input2')).toBeInTheDocument()
    })
  })

  describe('Multiple tools with labels', () => {
    it('should render multiple tools with dataset prefix', () => {
      const thought = createThought({
        tool: JSON.stringify(['dataset_123', 'dataset_456']),
        tool_input: JSON.stringify(['input1', 'input2']),
        observation: JSON.stringify(['output1', 'output2']),
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getAllByText(/knowledge/i)).toHaveLength(2)
    })

    it('should handle mixed dataset and regular tools', () => {
      const thought = createThought({
        tool: JSON.stringify(['dataset_123', 'regular-tool']),
        tool_input: JSON.stringify(['input1', 'input2']),
        observation: JSON.stringify(['output1', 'output2']),
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText(/knowledge/i)).toBeInTheDocument()
      expect(screen.getByText('regular-tool')).toBeInTheDocument()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty tool_input', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool_input: '',
        observation: 'output',
      })

      render(<Thought thought={thought} isFinished={true} />)

      await user.click(screen.getByText(/used/i))

      expect(screen.getByText(/requestTitle/i)).toBeInTheDocument()
    })

    it('should handle empty observation', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool_input: 'input',
        observation: '',
      })

      render(<Thought thought={thought} isFinished={true} />)

      await user.click(screen.getByText(/used/i))

      expect(screen.getByText(/responseTitle/i)).toBeInTheDocument()
    })

    it('should handle JSON array with undefined elements', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: JSON.stringify(['tool1', 'tool2']),
        tool_input: JSON.stringify(['input1']),
        observation: JSON.stringify(['output1']),
      })

      render(<Thought thought={thought} isFinished={true} />)

      const toolHeaders = screen.getAllByText(/used/i)
      await user.click(toolHeaders[1])

      expect(screen.getByText('tool2')).toBeInTheDocument()
    })
  })
})
