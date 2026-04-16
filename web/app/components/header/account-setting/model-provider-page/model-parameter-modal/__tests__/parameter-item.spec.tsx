import type { ModelParameterRule } from '../../declarations'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import ParameterItem from '../parameter-item'

vi.mock('../../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/base/ui/slider', () => ({
  Slider: ({ onValueChange }: { onValueChange: (v: number) => void }) => (
    <button onClick={() => onValueChange(2)} data-testid="slider-btn">Slide 2</button>
  ),
}))

vi.mock('@/app/components/base/tag-input', () => ({
  default: ({ onChange }: { onChange: (v: string[]) => void }) => (
    <button onClick={() => onChange(['tag1', 'tag2'])} data-testid="tag-input">Tag</button>
  ),
}))

let promptEditorOnChange: ((text: string) => void) | undefined
let capturedWorkflowNodesMap: Record<string, { title: string, type: string }> | undefined

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: ({ value, onChange, workflowVariableBlock }: {
    value: string
    onChange: (text: string) => void
    workflowVariableBlock?: {
      show: boolean
      variables: NodeOutPutVar[]
      workflowNodesMap?: Record<string, { title: string, type: string }>
    }
  }) => {
    promptEditorOnChange = onChange
    capturedWorkflowNodesMap = workflowVariableBlock?.workflowNodesMap
    return (
      <div data-testid="prompt-editor" data-value={value} data-has-workflow-vars={!!workflowVariableBlock?.variables}>
        {value}
      </div>
    )
  },
}))

describe('ParameterItem', () => {
  const createRule = (overrides: Partial<ModelParameterRule> = {}): ModelParameterRule => ({
    name: 'temp',
    label: { en_US: 'Temperature', zh_Hans: 'Temperature' },
    type: 'float',
    help: { en_US: 'Help text', zh_Hans: 'Help text' },
    required: false,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    promptEditorOnChange = undefined
    capturedWorkflowNodesMap = undefined
  })

  it('should render float controls and clamp numeric input to max', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0, max: 1 })} value={0.7} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '1.4' } })
    expect(onChange).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('slider-btn'))!.toBeInTheDocument()
  })

  it('should clamp float numeric input to min', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0.1, max: 1 })} value={0.7} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '0.05' } })
    expect(onChange).toHaveBeenCalledWith(0.1)
  })

  it('should render int controls and clamp numeric input', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 10 })} value={5} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '15' } })
    expect(onChange).toHaveBeenCalledWith(10)
    fireEvent.change(input, { target: { value: '-5' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('should adjust step based on max for int type', () => {
    const { rerender } = render(<ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 50 })} value={5} />)
    expect(screen.getByRole('spinbutton'))!.toHaveAttribute('step', '1')

    rerender(<ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 500 })} value={50} />)
    expect(screen.getByRole('spinbutton'))!.toHaveAttribute('step', '10')

    rerender(<ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 2000 })} value={50} />)
    expect(screen.getByRole('spinbutton'))!.toHaveAttribute('step', '100')
  })

  it('should render int input without slider if min or max is missing', () => {
    render(<ParameterItem parameterRule={createRule({ type: 'int', min: 0 })} value={5} />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton'))!.toHaveAttribute('step', '0')
  })

  it('should handle slide change and clamp values', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0, max: 10 })} value={0.7} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('slider-btn'))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('should render exact string input and propagate text changes', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'string', name: 'prompt' })} value="initial" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated' } })
    expect(onChange).toHaveBeenCalledWith('updated')
  })

  it('should render textarea for text type', () => {
    const onChange = vi.fn()
    const { container } = render(<ParameterItem parameterRule={createRule({ type: 'text' })} value="long text" onChange={onChange} />)
    const textarea = container.querySelector('textarea')!
    expect(textarea)!.toBeInTheDocument()
    fireEvent.change(textarea, { target: { value: 'new long text' } })
    expect(onChange).toHaveBeenCalledWith('new long text')
  })

  it('should render select for string with options', () => {
    render(<ParameterItem parameterRule={createRule({ type: 'string', options: ['a', 'b'] })} value="a" />)
    expect(screen.getByText('a'))!.toBeInTheDocument()
  })

  it('should render tag input for tag type', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'tag', tagPlaceholder: { en_US: 'placeholder', zh_Hans: 'placeholder' } })} value={['a']} onChange={onChange} />)
    expect(screen.getByText('placeholder'))!.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('tag-input'))
    expect(onChange).toHaveBeenCalledWith(['tag1', 'tag2'])
  })

  it('should render boolean radios and update value on click', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'boolean', default: false })} value={true} onChange={onChange} />)
    fireEvent.click(screen.getByText('False'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('should call onSwitch with current value when optional switch is toggled off', () => {
    const onSwitch = vi.fn()
    render(<ParameterItem parameterRule={createRule()} value={0.7} onSwitch={onSwitch} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onSwitch).toHaveBeenCalledWith(false, 0.7)
  })

  it('should not render switch if required or name is stop', () => {
    const { rerender } = render(<ParameterItem parameterRule={createRule({ required: true as unknown as false })} value={1} />)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    rerender(<ParameterItem parameterRule={createRule({ name: 'stop', required: false })} value={1} />)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('should use default values if value is undefined', () => {
    const { rerender } = render(<ParameterItem parameterRule={createRule({ type: 'float', default: 0.5 })} />)
    expect(screen.getByRole('spinbutton'))!.toHaveValue(0.5)

    rerender(<ParameterItem parameterRule={createRule({ type: 'string', default: 'hello' })} />)
    expect(screen.getByRole('textbox'))!.toHaveValue('hello')

    rerender(<ParameterItem parameterRule={createRule({ type: 'boolean', default: true })} />)
    expect(screen.getByText('True'))!.toBeInTheDocument()
    expect(screen.getByText('False'))!.toBeInTheDocument()

    rerender(<ParameterItem parameterRule={createRule({ type: 'float' })} />)
    expect(screen.getByRole('spinbutton'))!.toHaveValue(0)
  })

  it('should reset input to actual bound value on blur-sm', () => {
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0, max: 1 })} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(input)!.toHaveValue(1)
  })

  it('should render no input for unsupported parameter type', () => {
    render(<ParameterItem parameterRule={createRule({ type: 'unsupported' as unknown as string })} value={0.7} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  describe('workflow variable reference', () => {
    const mockNodesOutputVars: NodeOutPutVar[] = [
      { nodeId: 'node1', title: 'LLM Node', vars: [] },
    ]
    const mockAvailableNodes: Node[] = [
      { id: 'node1', type: 'custom', position: { x: 0, y: 0 }, data: { title: 'LLM Node', type: BlockEnum.LLM } } as Node,
      { id: 'start', type: 'custom', position: { x: 0, y: 0 }, data: { title: 'Start', type: BlockEnum.Start } } as Node,
    ]

    it('should build workflowNodesMap and render PromptEditor for string type', () => {
      const onChange = vi.fn()
      render(
        <ParameterItem
          parameterRule={createRule({ type: 'string', name: 'system_prompt' })}
          value="hello {{#node1.output#}}"
          onChange={onChange}
          isInWorkflow
          nodesOutputVars={mockNodesOutputVars}
          availableNodes={mockAvailableNodes}
        />,
      )

      const editor = screen.getByTestId('prompt-editor')
      expect(editor)!.toBeInTheDocument()
      expect(editor)!.toHaveAttribute('data-has-workflow-vars', 'true')
      expect(capturedWorkflowNodesMap).toBeDefined()
      expect(capturedWorkflowNodesMap!.node1!.title).toBe('LLM Node')
      expect(capturedWorkflowNodesMap!.sys!.title).toBe('workflow.blocks.start')
      expect(capturedWorkflowNodesMap!.sys!.type).toBe(BlockEnum.Start)

      promptEditorOnChange?.('updated text')
      expect(onChange).toHaveBeenCalledWith('updated text')
    })

    it('should build workflowNodesMap and render PromptEditor for text type', () => {
      const onChange = vi.fn()
      render(
        <ParameterItem
          parameterRule={createRule({ type: 'text', name: 'user_prompt' })}
          value="some long text"
          onChange={onChange}
          isInWorkflow
          nodesOutputVars={mockNodesOutputVars}
          availableNodes={mockAvailableNodes}
        />,
      )

      const editor = screen.getByTestId('prompt-editor')
      expect(editor)!.toBeInTheDocument()
      expect(editor)!.toHaveAttribute('data-has-workflow-vars', 'true')
      expect(capturedWorkflowNodesMap).toBeDefined()

      promptEditorOnChange?.('new long text')
      expect(onChange).toHaveBeenCalledWith('new long text')
    })

    it('should fall back to plain input when not in workflow mode for string type', () => {
      render(
        <ParameterItem
          parameterRule={createRule({ type: 'string', name: 'system_prompt' })}
          value="plain"
        />,
      )

      expect(screen.queryByTestId('prompt-editor')).not.toBeInTheDocument()
      expect(screen.getByRole('textbox'))!.toBeInTheDocument()
    })

    it('should return undefined workflowNodesMap when not in workflow mode', () => {
      render(
        <ParameterItem
          parameterRule={createRule({ type: 'string', name: 'system_prompt' })}
          value="plain"
          availableNodes={mockAvailableNodes}
        />,
      )

      expect(capturedWorkflowNodesMap).toBeUndefined()
    })
  })
})
