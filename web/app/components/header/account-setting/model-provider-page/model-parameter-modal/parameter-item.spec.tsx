import type { ModelParameterRule } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import ParameterItem from './parameter-item'

vi.mock('../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/base/radio', () => {
  const Radio = ({ children, value }: { children: React.ReactNode, value: boolean }) => <button data-testid={`radio-${value}`}>{children}</button>
  Radio.Group = ({ children, onChange }: { children: React.ReactNode, onChange: (value: boolean) => void }) => (
    <div>
      {children}
      <button onClick={() => onChange(true)}>Select True</button>
      <button onClick={() => onChange(false)}>Select False</button>
    </div>
  )
  return { default: Radio }
})

vi.mock('@/app/components/base/select', () => ({
  SimpleSelect: ({ onSelect, items }: { onSelect: (item: { value: string }) => void, items: { value: string, name: string }[] }) => (
    <select onChange={e => onSelect({ value: e.target.value })}>
      {items.map(item => (
        <option key={item.value} value={item.value}>{item.name}</option>
      ))}
    </select>
  ),
}))

vi.mock('@/app/components/base/slider', () => ({
  default: ({ value, onChange }: { value: number, onChange: (val: number) => void }) => (
    <input type="range" value={value} onChange={e => onChange(Number(e.target.value))} />
  ),
}))

vi.mock('@/app/components/base/switch', () => ({
  default: ({ onChange, value }: { onChange: (val: boolean) => void, value: boolean }) => (
    <button onClick={() => onChange(!value)}>Switch</button>
  ),
}))

vi.mock('@/app/components/base/tag-input', () => ({
  default: ({ onChange }: { onChange: (val: string[]) => void }) => (
    <input onChange={e => onChange(e.target.value.split(','))} />
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent }: { popupContent: React.ReactNode }) => <div>{popupContent}</div>,
}))

describe('ParameterItem', () => {
  const createRule = (overrides: Partial<ModelParameterRule> = {}): ModelParameterRule => ({
    name: 'temp',
    label: { en_US: 'Temperature', zh_Hans: 'Temperature' },
    type: 'float',
    min: 0,
    max: 1,
    help: { en_US: 'Help text', zh_Hans: 'Help text' },
    required: false,
    ...overrides,
  })

  const createProps = (overrides: {
    parameterRule?: ModelParameterRule
    value?: number | string | boolean | string[]
  } = {}) => {
    const onChange = vi.fn()
    const onSwitch = vi.fn()
    return {
      parameterRule: createRule(),
      value: 0.7,
      onChange,
      onSwitch,
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render float input with slider', () => {
    const props = createProps()
    const { rerender } = render(<ParameterItem {...props} />)

    expect(screen.getByText('Temperature')).toBeInTheDocument()
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '0.8' } })
    expect(props.onChange).toHaveBeenCalledWith(0.8)

    fireEvent.change(input, { target: { value: '1.4' } })
    expect(props.onChange).toHaveBeenCalledWith(1)

    fireEvent.change(input, { target: { value: '-0.2' } })
    expect(props.onChange).toHaveBeenCalledWith(0)

    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '2' } })
    expect(props.onChange).toHaveBeenCalledWith(1)

    fireEvent.change(slider, { target: { value: '-1' } })
    expect(props.onChange).toHaveBeenCalledWith(0)

    fireEvent.change(slider, { target: { value: '0.4' } })
    expect(props.onChange).toHaveBeenCalledWith(0.4)

    fireEvent.blur(input)
    expect(input).toHaveValue(0.7)

    const minBoundedProps = createProps({
      parameterRule: createRule({ type: 'float', min: 1, max: 2 }),
      value: 1.5,
    })
    rerender(<ParameterItem {...minBoundedProps} />)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
    expect(minBoundedProps.onChange).toHaveBeenCalledWith(1)
  })

  it('should render boolean radio', () => {
    const props = createProps({ parameterRule: createRule({ type: 'boolean', default: false }), value: true })
    render(<ParameterItem {...props} />)
    expect(screen.getByText('True')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Select False'))
    expect(props.onChange).toHaveBeenCalledWith(false)
  })

  it('should render string input and select options', () => {
    const props = createProps({ parameterRule: createRule({ type: 'string' }), value: 'test' })
    const { rerender } = render(<ParameterItem {...props} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'new' } })
    expect(props.onChange).toHaveBeenCalledWith('new')

    const selectProps = createProps({
      parameterRule: createRule({ type: 'string', options: ['opt1', 'opt2'] }),
      value: 'opt1',
    })
    rerender(<ParameterItem {...selectProps} />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'opt2' } })
    expect(selectProps.onChange).toHaveBeenCalledWith('opt2')
  })

  it('should handle switch toggle', () => {
    const props = createProps()
    let view = render(<ParameterItem {...props} />)
    fireEvent.click(screen.getByText('Switch'))
    expect(props.onSwitch).toHaveBeenCalledWith(false, 0.7)

    const intDefaultProps = createProps({
      parameterRule: createRule({ type: 'int', min: 0, default: undefined }),
      value: undefined,
    })
    view.unmount()
    view = render(<ParameterItem {...intDefaultProps} />)
    fireEvent.click(screen.getByText('Switch'))
    expect(intDefaultProps.onSwitch).toHaveBeenCalledWith(true, 0)

    const stringDefaultProps = createProps({
      parameterRule: createRule({ type: 'string', default: 'preset-value' }),
      value: undefined,
    })
    view.unmount()
    view = render(<ParameterItem {...stringDefaultProps} />)
    fireEvent.click(screen.getByText('Switch'))
    expect(stringDefaultProps.onSwitch).toHaveBeenCalledWith(true, 'preset-value')

    const booleanDefaultProps = createProps({
      parameterRule: createRule({ type: 'boolean', default: true }),
      value: undefined,
    })
    view.unmount()
    view = render(<ParameterItem {...booleanDefaultProps} />)
    fireEvent.click(screen.getByText('Switch'))
    expect(booleanDefaultProps.onSwitch).toHaveBeenCalledWith(true, true)

    const tagDefaultProps = createProps({
      parameterRule: createRule({ type: 'tag', default: ['one'] }),
      value: undefined,
    })
    view.unmount()
    const tagView = render(<ParameterItem {...tagDefaultProps} />)
    fireEvent.click(screen.getByText('Switch'))
    expect(tagDefaultProps.onSwitch).toHaveBeenCalledWith(true, ['one'])

    const zeroValueProps = createProps({
      parameterRule: createRule({ type: 'float', default: 0.5 }),
      value: 0,
    })
    tagView.unmount()
    render(<ParameterItem {...zeroValueProps} />)
    fireEvent.click(screen.getByText('Switch'))
    expect(zeroValueProps.onSwitch).toHaveBeenCalledWith(false, 0)
  })

  it('should support text and tag parameter interactions', () => {
    const textProps = createProps({
      parameterRule: createRule({ type: 'text', name: 'prompt' }),
      value: 'initial prompt',
    })
    const { rerender } = render(<ParameterItem {...textProps} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'rewritten prompt' } })
    expect(textProps.onChange).toHaveBeenCalledWith('rewritten prompt')

    const tagProps = createProps({
      parameterRule: createRule({
        type: 'tag',
        name: 'tags',
        tagPlaceholder: { en_US: 'Tag hint', zh_Hans: 'Tag hint' },
      }),
      value: ['alpha'],
    })
    rerender(<ParameterItem {...tagProps} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'one,two' } })
    expect(tagProps.onChange).toHaveBeenCalledWith(['one', 'two'])
  })

  it('should support int parameters and unknown type fallback', () => {
    const intProps = createProps({
      parameterRule: createRule({ type: 'int', min: 0, max: 500, default: 100 }),
      value: 100,
    })
    const { rerender } = render(<ParameterItem {...intProps} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '350' } })
    expect(intProps.onChange).toHaveBeenCalledWith(350)

    const unknownTypeProps = createProps({
      parameterRule: createRule({ type: 'unsupported' }),
      value: 0.7,
    })
    rerender(<ParameterItem {...unknownTypeProps} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
