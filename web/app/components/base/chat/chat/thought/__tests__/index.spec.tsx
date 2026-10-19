import type { ThoughtItem } from '../../type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Thought from '../index'

describe('Thought', () => {
  const createThought = (overrides?: Partial<ThoughtItem>): ThoughtItem => ({
    id: 'test-id',
    thought: '',
    message_id: 'message-1',
    conversation_id: 'conversation-1',
    position: 0,
    tool: 'test-tool',
    tool_input: 'test input',
    observation: 'test output',
    ...overrides,
  })

  describe('Rendering', () => {
    it('should render multiple tool thoughts from JSON array', () => {
      const thought = createThought({
        tool: JSON.stringify(['tool1', 'tool2']),
        tool_input: JSON.stringify(['input1', 'input2']),
        observation: JSON.stringify(['output1', 'output2']),
      })

      render(<Thought thought={thought} isFinished={false} />)

      expect(screen.getAllByText(/using/i)).toHaveLength(2)
      expect(screen.getByText('tool1'))!.toBeInTheDocument()
      expect(screen.getByText('tool2'))!.toBeInTheDocument()
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

      await user.click(screen.getByRole('button', { name: /used/i }))

      expect(screen.getByText('test input data'))!.toBeInTheDocument()
      expect(screen.getByText('test output data'))!.toBeInTheDocument()
    })
  })

  describe('Tool labels', () => {
    it('should fallback to tool name when toolName property is missing', () => {
      const thought = createThought({
        tool: 'another-tool',
        tool_labels: {},
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('another-tool'))!.toBeInTheDocument()
    })

    it('should show knowledge label for dataset tools', () => {
      const thought = createThought({
        tool: 'dataset_123',
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText(/knowledge/i))!.toBeInTheDocument()
    })
  })

  describe('Value parsing', () => {
    it('should handle invalid JSON in tool field', () => {
      const thought = createThought({
        tool: 'invalid-json-{',
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('invalid-json-{'))!.toBeInTheDocument()
    })

    it('should handle non-array JSON in tool field', () => {
      const thought = createThought({
        tool: JSON.stringify({ name: 'object-tool' }),
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText('{"name":"object-tool"}'))!.toBeInTheDocument()
    })

    it('should handle invalid JSON in tool_input when parsing array', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: JSON.stringify(['tool1']),
        tool_input: 'invalid-json-{',
      })

      render(<Thought thought={thought} isFinished={true} />)

      await user.click(screen.getByRole('button', { name: /used/i }))

      expect(screen.getByText('invalid-json-{'))!.toBeInTheDocument()
    })

    it('should handle invalid JSON in observation when parsing array', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: JSON.stringify(['tool1']),
        observation: 'invalid-json-[',
      })

      render(<Thought thought={thought} isFinished={true} />)

      await user.click(screen.getByRole('button', { name: /used/i }))

      expect(screen.getByText('invalid-json-['))!.toBeInTheDocument()
    })

    it('should extract correct values from JSON arrays by index', async () => {
      const user = userEvent.setup()
      const thought = createThought({
        tool: JSON.stringify(['tool1', 'tool2', 'tool3']),
        tool_input: JSON.stringify(['input1', 'input2', 'input3']),
        observation: JSON.stringify(['output1', 'output2', 'output3']),
      })

      render(<Thought thought={thought} isFinished={true} />)

      const toolSections = screen.getAllByRole('button', { name: /used/i })
      expect(toolSections).toHaveLength(3)

      await user.click(toolSections[0]!)
      expect(screen.getByText('input1'))!.toBeInTheDocument()
      expect(screen.getByText('output1'))!.toBeInTheDocument()
      expect(screen.queryByText('input2')).not.toBeInTheDocument()

      await user.click(toolSections[1]!)
      expect(screen.getByText('input2'))!.toBeInTheDocument()
      expect(screen.getByText('output2'))!.toBeInTheDocument()

      await user.click(toolSections[2]!)
      expect(screen.getByText('input3'))!.toBeInTheDocument()
      expect(screen.getByText('output3'))!.toBeInTheDocument()
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

      await user.click(screen.getByRole('button', { name: /used/i }))
      expect(screen.getByText('test input'))!.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /used/i }))
      expect(screen.queryByText('test input')).not.toBeInTheDocument()
    })
  })

  describe('Multiple tools with labels', () => {
    it('should handle mixed dataset and regular tools', () => {
      const thought = createThought({
        tool: JSON.stringify(['dataset_123', 'regular-tool']),
        tool_input: JSON.stringify(['input1', 'input2']),
        observation: JSON.stringify(['output1', 'output2']),
      })

      render(<Thought thought={thought} isFinished={true} />)

      expect(screen.getByText(/knowledge/i))!.toBeInTheDocument()
      expect(screen.getByText('regular-tool'))!.toBeInTheDocument()
    })
  })

  it('uses each tool’s translated label and falls back to its name when missing', () => {
    render(
      <Thought
        thought={createThought({
          tool: JSON.stringify(['search', 'weather', 'unlabelled']),
          tool_labels: {
            search: { en_US: 'Search documents', zh_Hans: '搜索文档' },
            weather: { en_US: 'Weather forecast', zh_Hans: '天气预报' },
          },
        })}
        isFinished
      />,
    )
    expect(screen.getByRole('button', { name: /Search documents/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Weather forecast/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /unlabelled/ })).toBeInTheDocument()
  })

  it('shows an empty response for a tool whose result has not arrived', async () => {
    render(
      <Thought
        thought={createThought({
          tool: JSON.stringify(['first', 'pending']),
          tool_input: JSON.stringify(['first input', 'pending input']),
          observation: JSON.stringify(['first output']),
        })}
        isFinished={false}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /using.*pending/ }))
    expect(screen.getByText('pending input')).toBeInTheDocument()
    expect(screen.queryByText('first output')).not.toBeInTheDocument()
    expect(screen.getByText(/responseTitle/)).toBeInTheDocument()
  })
})
