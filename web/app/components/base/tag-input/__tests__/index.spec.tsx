import type { ComponentProps } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagInput from '../index'

const mockNotify = vi.fn()

vi.mock('@/app/notifications', () => ({
  default: {
    notify: (args: unknown) => mockNotify(args),
  },
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

type TagInputProps = ComponentProps<typeof TagInput>

const renderTagInput = (props: Partial<TagInputProps> = {}) => {
  const onChange = vi.fn<(items: string[]) => void>()
  const items = props.items ?? []

  render(<TagInput items={items} onChange={onChange} {...props} />)

  return { onChange }
}

describe('TagInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should expose the current input text for CSS sizing', async () => {
      const user = userEvent.setup()
      renderTagInput({ placeholder: 'Tag' })
      const input = screen.getByRole('textbox')
      const inputContainer = input.parentElement

      expect(inputContainer).toHaveAttribute('data-input-value', 'Tag')

      await user.type(input, 'longer')

      expect(inputContainer).toHaveAttribute('data-input-value', 'longer')
    })

    it('should hide input when add is disabled', () => {
      renderTagInput({ disableAdd: true })

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should hide remove controls when remove is disabled', () => {
      renderTagInput({ items: ['alpha'], disableRemove: true })

      expect(
        screen.queryByRole('button', { name: 'common.operation.remove alpha' }),
      ).not.toBeInTheDocument()
    })
  })

  it('associates an external label with the tag entry input', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <label htmlFor="recipient-tags">Recipients</label>
        <TagInput id="recipient-tags" items={[]} onChange={onChange} />
      </>,
    )

    const input = screen.getByRole('textbox', { name: 'Recipients' })
    await user.click(screen.getByText('Recipients'))
    expect(input).toHaveFocus()
    await user.keyboard('alice{Enter}')
    expect(onChange).toHaveBeenCalledWith(['alice'])
  })

  describe('User Interactions', () => {
    it('should remove item when remove control is clicked', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ items: ['alpha', 'beta'] })

      const removeControl = screen.getByRole('button', { name: 'common.operation.remove alpha' })

      await user.click(removeControl)

      expect(onChange).toHaveBeenCalledWith(['beta'])
    })

    it('should add trimmed tag on Enter and clear input', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput()
      const input = screen.getByRole('textbox')

      await user.type(input, '  new-tag  ')
      await user.type(input, '{Enter}')

      expect(onChange).toHaveBeenCalledWith(['new-tag'])
      await waitFor(() => {
        expect(input)!.toHaveValue('')
      })
    })

    it('should add tag on blur when input has valid value', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput()
      const input = screen.getByRole('textbox')

      await user.type(input, 'blur-tag')
      await user.click(document.body)

      expect(onChange).toHaveBeenCalledWith(['blur-tag'])
    })

    it('should append return marker on Enter and confirm on Tab in special mode', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ customizedConfirmKey: 'Tab' })
      const input = screen.getByRole('textbox')

      // Type normally
      await user.type(input, 'stop')
      await user.keyboard('{Enter}')

      expect(input)!.toHaveValue('stop↵')
      expect(onChange).not.toHaveBeenCalled()

      await user.keyboard('{Tab}')
      expect(input).toHaveFocus()
      expect(onChange).toHaveBeenCalledWith(['stop↵'])
    })
  })

  describe('Validation', () => {
    it('should notify duplicate error when tag already exists', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ items: ['dup-tag'] })
      const input = screen.getByRole('textbox')

      await user.type(input, 'dup-tag')
      await user.keyboard('{Enter}')

      expect(onChange).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordDuplicate',
      })
    })

    it('should notify length error when tag is longer than 20 chars', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput()
      const input = screen.getByRole('textbox')

      await user.type(input, 'a'.repeat(21))
      await user.keyboard('{Enter}')

      expect(onChange).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordError',
      })
    })

    it('should notify required error when value is empty and required is true', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ required: true })
      const input = screen.getByRole('textbox')

      await user.type(input, '   ')
      await user.click(document.body)

      expect(onChange).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordEmpty',
      })
    })

    it('should ignore empty value when required is false', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ required: false })
      const input = screen.getByRole('textbox')

      await user.type(input, '   ')
      await user.click(document.body)

      expect(onChange).not.toHaveBeenCalled()
      expect(mockNotify).not.toHaveBeenCalled()
    })
  })
})
