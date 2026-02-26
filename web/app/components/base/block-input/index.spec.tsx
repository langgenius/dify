import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import Toast from '@/app/components/base/toast'
import BlockInput, { getInputKeys } from './index'

vi.mock('@/utils/var', () => ({
  checkKeys: vi.fn((_keys: string[]) => ({
    isValid: true,
    errorMessageKey: '',
    errorKey: '',
  })),
}))

describe('BlockInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Toast, 'notify')
    cleanup()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<BlockInput value="" />)
      const wrapper = screen.getByTestId('block-input')
      expect(wrapper).toBeInTheDocument()
    })

    it('should render with initial value', () => {
      const { container } = render(<BlockInput value="Hello World" />)
      expect(container.textContent).toContain('Hello World')
    })

    it('should render variable highlights', () => {
      render(<BlockInput value="Hello {{name}}" />)
      const nameElement = screen.getByText('name')
      expect(nameElement).toBeInTheDocument()
      expect(nameElement.parentElement).toHaveClass('text-primary-600')
    })

    it('should render multiple variable highlights', () => {
      render(<BlockInput value="{{foo}} and {{bar}}" />)
      expect(screen.getByText('foo')).toBeInTheDocument()
      expect(screen.getByText('bar')).toBeInTheDocument()
    })

    it('should display character count in footer when not readonly', () => {
      render(<BlockInput value="Hello" />)
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('should hide footer in readonly mode', () => {
      render(<BlockInput value="Hello" readonly />)
      expect(screen.queryByText('5')).not.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      render(<BlockInput value="test" className="custom-class" />)
      const innerContent = screen.getByTestId('block-input-content')
      expect(innerContent).toHaveClass('custom-class')
    })

    it('should apply readonly prop with max height', () => {
      render(<BlockInput value="test" readonly />)
      const contentDiv = screen.getByTestId('block-input').firstChild as Element
      expect(contentDiv).toHaveClass('max-h-[180px]')
    })

    it('should have default empty value', () => {
      render(<BlockInput value="" />)
      const contentDiv = screen.getByTestId('block-input')
      expect(contentDiv).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should enter edit mode when clicked', async () => {
      render(<BlockInput value="Hello" />)

      const contentArea = screen.getByText('Hello')
      fireEvent.click(contentArea)

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument()
      })
    })

    it('should update value when typing in edit mode', async () => {
      const onConfirm = vi.fn()
      const { checkKeys } = await import('@/utils/var')
        ; (checkKeys as ReturnType<typeof vi.fn>).mockReturnValue({ isValid: true, errorMessageKey: '', errorKey: '' })

      render(<BlockInput value="Hello" onConfirm={onConfirm} />)

      const contentArea = screen.getByText('Hello')
      fireEvent.click(contentArea)

      const textarea = await screen.findByRole('textbox')
      fireEvent.change(textarea, { target: { value: 'Hello World' } })

      expect(textarea).toHaveValue('Hello World')
    })

    it('should call onConfirm on value change with valid keys', async () => {
      const onConfirm = vi.fn()
      const { checkKeys } = await import('@/utils/var')
        ; (checkKeys as ReturnType<typeof vi.fn>).mockReturnValue({ isValid: true, errorMessageKey: '', errorKey: '' })

      render(<BlockInput value="initial" onConfirm={onConfirm} />)

      const contentArea = screen.getByText('initial')
      fireEvent.click(contentArea)

      const textarea = await screen.findByRole('textbox')
      fireEvent.change(textarea, { target: { value: '{{name}}' } })

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith('{{name}}', ['name'])
      })
    })

    it('should show error toast on value change with invalid keys', async () => {
      const onConfirm = vi.fn()
      const { checkKeys } = await import('@/utils/var');
      (checkKeys as ReturnType<typeof vi.fn>).mockReturnValue({
        isValid: false,
        errorMessageKey: 'invalidKey',
        errorKey: 'test_key',
      })

      render(<BlockInput value="initial" onConfirm={onConfirm} />)

      const contentArea = screen.getByText('initial')
      fireEvent.click(contentArea)

      const textarea = await screen.findByRole('textbox')
      fireEvent.change(textarea, { target: { value: '{{invalid}}' } })

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalled()
      })
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should not enter edit mode when readonly is true', () => {
      render(<BlockInput value="Hello" readonly />)

      const contentArea = screen.getByText('Hello')
      fireEvent.click(contentArea)

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string value', () => {
      const { container } = render(<BlockInput value="" />)
      expect(container.textContent).toBe('0')
      const span = screen.getByTestId('block-input').querySelector('span')
      expect(span).toBeInTheDocument()
      expect(span).toBeEmptyDOMElement()
    })

    it('should handle value without variables', () => {
      render(<BlockInput value="plain text" />)
      expect(screen.getByText('plain text')).toBeInTheDocument()
    })

    it('should handle newlines in value', () => {
      render(<BlockInput value="line1\nline2" />)
      expect(screen.getByText(/line1/)).toBeInTheDocument()
    })

    it('should handle multiple same variables', () => {
      render(<BlockInput value="{{name}} and {{name}}" />)
      const highlights = screen.getAllByText('name')
      expect(highlights).toHaveLength(2)
    })

    it('should handle value with only variables', () => {
      render(<BlockInput value="{{foo}}{{bar}}{{baz}}" />)
      expect(screen.getByText('foo')).toBeInTheDocument()
      expect(screen.getByText('bar')).toBeInTheDocument()
      expect(screen.getByText('baz')).toBeInTheDocument()
    })

    it('should handle text adjacent to variables', () => {
      render(<BlockInput value="prefix {{var}} suffix" />)
      expect(screen.getByText(/prefix/)).toBeInTheDocument()
      expect(screen.getByText(/suffix/)).toBeInTheDocument()
    })
  })
})

describe('getInputKeys', () => {
  it('should extract keys from {{}} syntax', () => {
    const keys = getInputKeys('Hello {{name}}')
    expect(keys).toEqual(['name'])
  })

  it('should extract multiple keys', () => {
    const keys = getInputKeys('{{foo}} and {{bar}}')
    expect(keys).toEqual(['foo', 'bar'])
  })

  it('should remove duplicate keys', () => {
    const keys = getInputKeys('{{name}} and {{name}}')
    expect(keys).toEqual(['name'])
  })

  it('should return empty array for no variables', () => {
    const keys = getInputKeys('plain text')
    expect(keys).toEqual([])
  })

  it('should return empty array for empty string', () => {
    const keys = getInputKeys('')
    expect(keys).toEqual([])
  })

  it('should handle keys with underscores and numbers', () => {
    const keys = getInputKeys('{{user_1}} and {{user_2}}')
    expect(keys).toEqual(['user_1', 'user_2'])
  })
})
