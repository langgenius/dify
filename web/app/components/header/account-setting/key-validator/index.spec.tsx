import type { ComponentProps } from 'react'
import type { Form } from './declarations'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import KeyValidator from './index'

let subscriptionCallback: ((value: string) => void) | null = null
const mockEmit = vi.fn((value: string) => {
  subscriptionCallback?.(value)
})

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
      useSubscription: (cb: (value: string) => void) => {
        subscriptionCallback = cb
      },
    },
  }),
}))

const mockValidate = vi.fn()
const mockUseValidate = vi.fn()

vi.mock('./hooks', () => ({
  useValidate: (...args: unknown[]) => mockUseValidate(...args),
}))

describe('KeyValidator', () => {
  const formValidate = {
    before: () => true,
  }

  const forms: Form[] = [
    {
      key: 'apiKey',
      title: 'API key',
      placeholder: 'Enter API key',
      value: 'initial-key',
      validate: formValidate,
      handleFocus: (_value, setValue) => {
        setValue(prev => ({ ...prev, apiKey: 'focused-key' }))
      },
    },
  ]

  const createProps = (overrides: Partial<ComponentProps<typeof KeyValidator>> = {}) => ({
    type: 'test-provider',
    title: <div>Provider key</div>,
    status: 'add' as const,
    forms,
    keyFrom: {
      text: 'Get key',
      link: 'https://example.com/key',
    },
    onSave: vi.fn().mockResolvedValue(true),
    disabled: false,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    subscriptionCallback = null
    mockValidate.mockImplementation((config?: { before?: () => boolean }) => config?.before?.())
    mockUseValidate.mockReturnValue([mockValidate, false, {}])
  })

  it('should open and close the editor from add and cancel actions', () => {
    render(<KeyValidator {...createProps()} />)

    fireEvent.click(screen.getByText('common.provider.addKey'))

    expect(screen.getByPlaceholderText('Enter API key')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get key' })).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.operation.cancel'))

    expect(screen.queryByPlaceholderText('Enter API key')).toBeNull()
  })

  it('should submit the updated value when save is clicked', async () => {
    render(<KeyValidator {...createProps()} />)

    fireEvent.click(screen.getByText('common.provider.addKey'))
    const input = screen.getByPlaceholderText('Enter API key')

    fireEvent.focus(input)
    expect(input).toHaveValue('focused-key')

    fireEvent.change(input, {
      target: { value: 'updated-key' },
    })
    fireEvent.click(screen.getByText('common.operation.save'))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Enter API key')).toBeNull()
    })
  })

  it('should keep the editor open when save does not succeed', async () => {
    const formsWithoutValidation: Form[] = [
      {
        key: 'apiKey',
        title: 'API key',
        placeholder: 'Enter API key',
      },
    ]
    const props = createProps({
      forms: formsWithoutValidation,
      onSave: vi.fn().mockResolvedValue(false),
    })
    render(<KeyValidator {...props} />)

    fireEvent.click(screen.getByText('common.provider.addKey'))
    const input = screen.getByPlaceholderText('Enter API key')

    expect(input).toHaveValue('')

    fireEvent.focus(input)
    fireEvent.change(input, {
      target: { value: 'typed-without-validator' },
    })
    fireEvent.click(screen.getByText('common.operation.save'))

    expect(screen.getByPlaceholderText('Enter API key')).toBeInTheDocument()
  })

  it('should close and reset edited values when another validator emits a trigger', () => {
    render(<KeyValidator {...createProps()} />)

    fireEvent.click(screen.getByText('common.provider.addKey'))
    fireEvent.change(screen.getByPlaceholderText('Enter API key'), {
      target: { value: 'changed' },
    })

    act(() => {
      subscriptionCallback?.('plugins/another-provider')
    })

    expect(screen.queryByPlaceholderText('Enter API key')).toBeNull()

    fireEvent.click(screen.getByText('common.provider.addKey'))

    expect(screen.getByPlaceholderText('Enter API key')).toHaveValue('initial-key')
  })

  it('should prevent opening key editor when disabled', () => {
    render(<KeyValidator {...createProps()} disabled />)

    fireEvent.click(screen.getByText('common.provider.addKey'))

    expect(screen.queryByPlaceholderText('Enter API key')).toBeNull()
  })

  it('should open the editor from edit action when validator is in success state', () => {
    render(<KeyValidator {...createProps({ status: 'success' })} />)

    fireEvent.click(screen.getByText('common.provider.editKey'))

    expect(screen.getByPlaceholderText('Enter API key')).toBeInTheDocument()
  })
})
