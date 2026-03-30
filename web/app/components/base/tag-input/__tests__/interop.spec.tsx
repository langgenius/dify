import type { ComponentType, InputHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'

const mockNotify = vi.fn()

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
    vi.doMock('@/app/components/base/toast/context', () => ({
      useToastContext: () => ({
        notify: mockNotify,
      }),
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
    vi.doMock('@/app/components/base/toast/context', () => ({
      useToastContext: () => ({
        notify: mockNotify,
      }),
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
