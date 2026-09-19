import { act, fireEvent, render, screen } from '@testing-library/react'
import { mockEmojiData } from '@/test/emoji-picker'
import EmojiPicker from '../index'

mockEmojiData()

describe('EmojiPicker', () => {
  const mockOnSelect = vi.fn()
  const mockOnOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders nothing when closed', () => {
      const { container } = render(<EmojiPicker open={false} onOpenChange={mockOnOpenChange} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders modal when open', async () => {
      await act(async () => {
        render(<EmojiPicker open onOpenChange={mockOnOpenChange} />)
      })
      expect(screen.getByRole('dialog', { name: /Emoji/i }))!.toBeInTheDocument()
      expect(screen.getByPlaceholderText('common.operation.search'))!.toBeInTheDocument()
      expect(screen.getByText(/Cancel/i))!.toBeInTheDocument()
      expect(screen.getByText(/OK/i))!.toBeInTheDocument()
    })

    it('OK button is disabled initially', async () => {
      await act(async () => {
        render(<EmojiPicker open onOpenChange={mockOnOpenChange} />)
      })
      const okButton = screen.getByText(/OK/i).closest('button')
      expect(okButton)!.toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('calls onSelect with selected emoji and background when OK is clicked', async () => {
      await act(async () => {
        render(<EmojiPicker open onOpenChange={mockOnOpenChange} onSelect={mockOnSelect} />)
      })

      fireEvent.click(await screen.findByRole('gridcell', { name: 'Grinning face' }))

      const okButton = screen.getByText(/OK/i)
      expect(okButton.closest('button')).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(okButton)
      })

      expect(mockOnSelect).toHaveBeenCalledWith(expect.any(String), expect.any(String))
    })

    it('closes when Cancel is clicked', async () => {
      await act(async () => {
        render(<EmojiPicker open onOpenChange={mockOnOpenChange} />)
      })

      const cancelButton = screen.getByText(/Cancel/i)
      await act(async () => {
        fireEvent.click(cancelButton)
      })

      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
