import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ValidatedStatus } from './declarations'
import KeyInput from './KeyInput'

type Props = ComponentProps<typeof KeyInput>

const createProps = (overrides: Partial<Props> = {}): Props => ({
  name: 'API key',
  placeholder: 'Enter API key',
  value: 'initial-value',
  onChange: vi.fn(),
  onFocus: undefined,
  validating: false,
  validatedStatusState: {},
  ...overrides,
})

describe('KeyInput', () => {
  it('shows the label and placeholder value', () => {
    const props = createProps()
    render(<KeyInput {...props} />)

    expect(screen.getByText('API key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter API key')).toHaveValue('initial-value')
  })

  it('updates the visible input value when user types', () => {
    const ControlledKeyInput = () => {
      const [value, setValue] = useState('initial-value')
      return (
        <KeyInput
          {...createProps({
            value,
            onChange: setValue,
          })}
        />
      )
    }

    render(<ControlledKeyInput />)
    fireEvent.change(screen.getByPlaceholderText('Enter API key'), { target: { value: 'updated' } })

    expect(screen.getByPlaceholderText('Enter API key')).toHaveValue('updated')
  })

  it('cycles through validating and error messaging', () => {
    const props = createProps()
    const { rerender } = render(
      <KeyInput {...props} validating validatedStatusState={{}} />,
    )

    expect(screen.getByText('common.provider.validating')).toBeInTheDocument()

    rerender(
      <KeyInput
        {...props}
        validating={false}
        validatedStatusState={{ status: ValidatedStatus.Error, message: 'bad-request' }}
      />,
    )

    expect(screen.getByText('common.provider.validatedErrorbad-request')).toBeInTheDocument()
  })

  it('does not show an error tip for exceed status', () => {
    render(
      <KeyInput
        {...createProps({
          validating: false,
          validatedStatusState: { status: ValidatedStatus.Exceed, message: 'quota' },
        })}
      />,
    )

    expect(screen.queryByText(/common\.provider\.validatedError/i)).toBeNull()
  })

  it('does not show validating or error text for success status', () => {
    render(
      <KeyInput
        {...createProps({
          validating: false,
          validatedStatusState: { status: ValidatedStatus.Success },
        })}
      />,
    )

    expect(screen.queryByText('common.provider.validating')).toBeNull()
    expect(screen.queryByText(/common\.provider\.validatedError/i)).toBeNull()
  })

  it('shows fallback error text when error message is missing', () => {
    render(
      <KeyInput
        {...createProps({
          validating: false,
          validatedStatusState: { status: ValidatedStatus.Error },
        })}
      />,
    )

    expect(screen.getByText('common.provider.validatedError')).toBeInTheDocument()
  })
})
