import type { ComponentProps } from 'react'
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagInput from './index'

const mockNotify = vi.fn()

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
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
    it('should render existing tags and default placeholder', () => {
      renderTagInput({ items: ['alpha', 'beta'] })

      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.getByText('beta')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('datasetDocuments.segment.addKeyWord')).toBeInTheDocument()
    })

    it('should render special mode placeholder when confirm key is Tab', () => {
      renderTagInput({ customizedConfirmKey: 'Tab' })

      expect(screen.getByPlaceholderText('common.model.params.stop_sequencesPlaceholder')).toBeInTheDocument()
    })

    it('should render custom placeholder when placeholder prop is provided', () => {
      renderTagInput({ placeholder: 'Custom placeholder' })

      expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument()
    })

    it('should hide input when add is disabled', () => {
      renderTagInput({ disableAdd: true })

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should hide remove controls when remove is disabled', () => {
      renderTagInput({ items: ['alpha'], disableRemove: true })

      expect(screen.queryByTestId('remove-tag')).not.toBeInTheDocument()
    })

    it('should apply focused style in special mode when input is focused', async () => {
      renderTagInput({ customizedConfirmKey: 'Tab' })
      const input = screen.getByRole('textbox')
      const inputContainer = input.parentElement

      expect(inputContainer).toHaveClass('border-transparent')

      await userEvent.click(input)

      expect(inputContainer).toHaveClass('border-dashed')
    })
  })

  describe('User Interactions', () => {
    it('should remove item when remove control is clicked', async () => {
      const { onChange } = renderTagInput({ items: ['alpha', 'beta'] })

      const removeControl = screen.getAllByTestId('remove-tag')[0]

      await userEvent.click(removeControl)

      expect(onChange).toHaveBeenCalledWith(['beta'])
    })

    it('should add trimmed tag on Enter and clear input', async () => {
      const { onChange } = renderTagInput()
      const input = screen.getByRole('textbox')

      await userEvent.type(input, '  new-tag  ')
      await userEvent.type(input, '{Enter}')

      expect(onChange).toHaveBeenCalledWith(['new-tag'])
      await waitFor(() => {
        expect(input).toHaveValue('')
      })
    })

    it('should add tag on blur when input has valid value', async () => {
      const { onChange } = renderTagInput()
      const input = screen.getByRole('textbox')

      await userEvent.type(input, 'blur-tag')
      await userEvent.click(document.body)

      expect(onChange).toHaveBeenCalledWith(['blur-tag'])
    })

    it('should append return marker on Enter and confirm on Tab in special mode', async () => {
      const user = userEvent.setup()
      const { onChange } = renderTagInput({ customizedConfirmKey: 'Tab' })
      const input = screen.getByRole('textbox')

      // Type normally
      await user.type(input, 'stop')
      await user.keyboard('{Enter}')

      expect(input).toHaveValue('stop↵')
      expect(onChange).not.toHaveBeenCalled()

      // Low-level test for preventDefault
      const tabEvent = createEvent.keyDown(input, { key: 'Tab' })
      tabEvent.preventDefault = vi.fn()

      fireEvent(input, tabEvent)

      expect(tabEvent.preventDefault).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(['stop↵'])
    })
  })

  describe('Validation', () => {
    it('should notify duplicate error when tag already exists', async () => {
      const { onChange } = renderTagInput({ items: ['dup-tag'] })
      const input = screen.getByRole('textbox')

      await userEvent.type(input, 'dup-tag')
      await userEvent.keyboard('{Enter}')

      expect(onChange).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordDuplicate',
      })
    })

    it('should notify length error when tag is longer than 20 chars', async () => {
      const { onChange } = renderTagInput()
      const input = screen.getByRole('textbox')

      await userEvent.type(input, 'a'.repeat(21))
      await userEvent.keyboard('{Enter}')

      expect(onChange).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordError',
      })
    })

    it('should notify required error when value is empty and required is true', async () => {
      const { onChange } = renderTagInput({ required: true })
      const input = screen.getByRole('textbox')

      await userEvent.type(input, '   ')
      await userEvent.click(document.body)

      expect(onChange).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordEmpty',
      })
    })

    it('should ignore empty value when required is false', async () => {
      const { onChange } = renderTagInput({ required: false })
      const input = screen.getByRole('textbox')

      await userEvent.type(input, '   ')
      await userEvent.click(document.body)

      expect(onChange).not.toHaveBeenCalled()
      expect(mockNotify).not.toHaveBeenCalled()
    })
  })
})
