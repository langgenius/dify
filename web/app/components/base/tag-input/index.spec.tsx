import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContext } from '../toast'
import TagInput from './index'

const renderTagInput = (props?: Partial<React.ComponentProps<typeof TagInput>>) => {
  const onChange = vi.fn()
  const notify = vi.fn()

  render(
    <ToastContext.Provider value={{ notify, close: vi.fn() }}>
      <TagInput
        items={[]}
        onChange={onChange}
        {...props}
      />
    </ToastContext.Provider>,
  )

  return { onChange, notify }
}

describe('TagInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering and prop-driven input state.
  describe('Rendering', () => {
    it('should render tags and default placeholder', () => {
      renderTagInput({ items: ['alpha', 'beta'] })

      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.getByText('beta')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('datasetDocuments.segment.addKeyWord')).toBeInTheDocument()
    })

    it('should hide input when disableAdd is true', () => {
      renderTagInput({ items: ['alpha'], disableAdd: true })

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })

    it('should use custom placeholder when provided', () => {
      renderTagInput({ placeholder: 'Custom placeholder' })

      expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument()
    })
  })

  // User interactions for add/remove flows.
  describe('User Interactions', () => {
    it('should remove selected tag when clicking remove button', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ items: ['alpha', 'beta'] })

      const removeButton = screen.getAllByTestId('tag-remove-button')[0]
      expect(removeButton).toBeInTheDocument()

      await user.click(removeButton as HTMLElement)
      expect(onChange).toHaveBeenCalledWith(['beta'])
    })

    it('should add a new tag when pressing Enter', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ items: ['alpha'] })

      const input = screen.getByRole('textbox')
      await user.type(input, 'gamma')
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledWith(['alpha', 'gamma'])
      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })

    it('should add a new tag on blur', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ items: ['alpha'] })

      const input = screen.getByRole('textbox')
      await user.type(input, 'delta')
      await user.click(document.body)

      expect(onChange).toHaveBeenCalledWith(['alpha', 'delta'])
    })
  })

  // Validation errors surfaced through toast notifications.
  describe('Validation', () => {
    it('should notify empty-keyword error when required and value is blank', async () => {
      const user = userEvent.setup()
      const { onChange, notify } = renderTagInput({ required: true })

      const input = screen.getByRole('textbox')
      await user.type(input, '   ')
      await user.keyboard('{Enter}')

      expect(onChange).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordEmpty',
      })
    })

    it('should notify duplicate error when value already exists', async () => {
      const user = userEvent.setup()
      const { onChange, notify } = renderTagInput({ items: ['alpha'] })

      const input = screen.getByRole('textbox')
      await user.type(input, 'alpha')
      await user.keyboard('{Enter}')

      expect(onChange).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordDuplicate',
      })
    })

    it('should notify length error when value is longer than twenty characters', async () => {
      const user = userEvent.setup()
      const { onChange, notify } = renderTagInput()

      const input = screen.getByRole('textbox')
      await user.type(input, '123456789012345678901')
      await user.keyboard('{Enter}')

      expect(onChange).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordError',
      })
    })
  })

  // Special confirm-key mode behavior for stop sequences.
  describe('Special Confirm Key Mode', () => {
    it('should append return marker on Enter and submit on Tab', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ customizedConfirmKey: 'Tab' })

      const input = screen.getByRole('textbox')
      expect(screen.getByPlaceholderText('common.model.params.stop_sequencesPlaceholder')).toBeInTheDocument()

      await user.type(input, 'line1')
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()
      expect(input).toHaveValue('line1↵')

      await user.keyboard('{Tab}')
      expect(onChange).toHaveBeenCalledWith(['line1↵'])
    })
  })
})
