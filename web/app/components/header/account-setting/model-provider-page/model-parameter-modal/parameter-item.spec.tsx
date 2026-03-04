import type { ModelParameterRule } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import ParameterItem from './parameter-item'

vi.mock('../hooks', () => ({
  useLanguage: () => 'en_US',
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

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render float controls and clamp numeric input to max', () => {
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'float', min: 0, max: 1 })}
        value={0.7}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '1.4' } })

    expect(onChange).toHaveBeenCalledWith(1)
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('should call onSwitch with current value when optional switch is toggled off', () => {
    const onSwitch = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule()}
        value={0.7}
        onSwitch={onSwitch}
      />,
    )

    fireEvent.click(screen.getByRole('switch'))
    expect(onSwitch).toHaveBeenCalledWith(false, 0.7)
  })

  it('should render boolean radios and update value on click', () => {
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'boolean', default: false })}
        value={true}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('False'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('should render string input and propagate text changes', () => {
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'string', name: 'prompt' })}
        value="initial"
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated' } })
    expect(onChange).toHaveBeenCalledWith('updated')
  })

  it('should render no input for unsupported parameter type', () => {
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'unsupported' })}
        value={0.7}
      />,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
