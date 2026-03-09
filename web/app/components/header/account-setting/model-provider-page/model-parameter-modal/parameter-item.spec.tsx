import type { ModelParameterRule } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import ParameterItem from './parameter-item'

vi.mock('../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/base/slider', () => ({
  default: ({ onChange }: { onChange: (v: number) => void }) => (
    <button onClick={() => onChange(2)} data-testid="slider-btn">Slide 2</button>
  ),
}))

vi.mock('@/app/components/base/tag-input', () => ({
  default: ({ onChange }: { onChange: (v: string[]) => void }) => (
    <button onClick={() => onChange(['tag1', 'tag2'])} data-testid="tag-input">Tag</button>
  ),
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
  })

  // Float tests
  it('should render float controls and clamp numeric input to max', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0, max: 1 })} value={0.7} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '1.4' } })
    expect(onChange).toHaveBeenCalledWith(1)
    expect(screen.getByTestId('slider-btn')).toBeInTheDocument()
  })

  it('should clamp float numeric input to min', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0.1, max: 1 })} value={0.7} onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '0.05' } })
    expect(onChange).toHaveBeenCalledWith(0.1)
  })

  // Int tests
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
    expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '1')

    rerender(<ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 500 })} value={50} />)
    expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '10')

    rerender(<ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 2000 })} value={50} />)
    expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '100')
  })

  it('should render int input without slider if min or max is missing', () => {
    render(<ParameterItem parameterRule={createRule({ type: 'int', min: 0 })} value={5} />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    // No max -> precision step
    expect(screen.getByRole('spinbutton')).toHaveAttribute('step', '0')
  })

  // Slider events (uses generic value mock for slider)
  it('should handle slide change and clamp values', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0, max: 10 })} value={0.7} onChange={onChange} />)

    // Test that the actual slider triggers the onChange logic correctly
    // The implementation of Slider uses onChange(val) directly via the mock
    fireEvent.click(screen.getByTestId('slider-btn'))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  // Text & String tests
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
    expect(textarea).toBeInTheDocument()
    fireEvent.change(textarea, { target: { value: 'new long text' } })
    expect(onChange).toHaveBeenCalledWith('new long text')
  })

  it('should render select for string with options', () => {
    render(<ParameterItem parameterRule={createRule({ type: 'string', options: ['a', 'b'] })} value="a" />)
    // SimpleSelect renders an element with text 'a'
    expect(screen.getByText('a')).toBeInTheDocument()
  })

  // Tag Tests
  it('should render tag input for tag type', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'tag', tagPlaceholder: { en_US: 'placeholder', zh_Hans: 'placeholder' } })} value={['a']} onChange={onChange} />)
    expect(screen.getByText('placeholder')).toBeInTheDocument()
    // Trigger mock tag input
    fireEvent.click(screen.getByTestId('tag-input'))
    expect(onChange).toHaveBeenCalledWith(['tag1', 'tag2'])
  })

  // Boolean tests
  it('should render boolean radios and update value on click', () => {
    const onChange = vi.fn()
    render(<ParameterItem parameterRule={createRule({ type: 'boolean', default: false })} value={true} onChange={onChange} />)
    fireEvent.click(screen.getByText('False'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  // Switch tests
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

  // Default Value Fallbacks (rendering without value)
  it('should use default values if value is undefined', () => {
    const { rerender } = render(<ParameterItem parameterRule={createRule({ type: 'float', default: 0.5 })} />)
    expect(screen.getByRole('spinbutton')).toHaveValue(0.5)

    rerender(<ParameterItem parameterRule={createRule({ type: 'string', default: 'hello' })} />)
    expect(screen.getByRole('textbox')).toHaveValue('hello')

    rerender(<ParameterItem parameterRule={createRule({ type: 'boolean', default: true })} />)
    expect(screen.getByText('True')).toBeInTheDocument()
    expect(screen.getByText('False')).toBeInTheDocument()

    // Without default
    rerender(<ParameterItem parameterRule={createRule({ type: 'float' })} />) // min is 0 by default in createRule
    expect(screen.getByRole('spinbutton')).toHaveValue(0)
  })

  // Input Blur
  it('should reset input to actual bound value on blur', () => {
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0, max: 1 })} />)
    const input = screen.getByRole('spinbutton')
    // change local state (which triggers clamp internally to let's say 1.4 -> 1 but leaves input text, though handleInputChange updates local state)
    // Actually our test fires a change so localValue = 1, then blur sets it
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(1)
  })

  // Unsupported
  it('should render no input for unsupported parameter type', () => {
    render(<ParameterItem parameterRule={createRule({ type: 'unsupported' as unknown as string })} value={0.7} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
