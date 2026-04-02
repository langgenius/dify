import type { ComponentType, InputHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'

type AutosizeInputProps = InputHTMLAttributes<HTMLInputElement> & {
  inputClassName?: string
}

const MockAutosizeInput: ComponentType<AutosizeInputProps> = ({ inputClassName, ...props }) => (
  <input data-testid="autosize-input" className={inputClassName} {...props} />
)

describe('TagInput autosize interop', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('should support a namespace-style default export from react-18-input-autosize', async () => {
    const toast = Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    })
    vi.doMock('@/app/components/base/ui/toast', () => ({
      toast,
    }))
    vi.doMock('react-18-input-autosize', () => ({
      default: {
        default: MockAutosizeInput,
      },
    }))

    const { default: TagInput } = await import('../index')

    render(<TagInput items={[]} onChange={vi.fn()} />)

    expect(screen.getByTestId('autosize-input')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should support a direct default export from react-18-input-autosize', async () => {
    const toast = Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    })
    vi.doMock('@/app/components/base/ui/toast', () => ({
      toast,
    }))
    vi.doMock('react-18-input-autosize', () => ({
      default: MockAutosizeInput,
    }))

    const { default: TagInput } = await import('../index')

    render(<TagInput items={[]} onChange={vi.fn()} />)

    expect(screen.getByTestId('autosize-input')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
