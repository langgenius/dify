import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
      expect(screen.getByPlaceholderText('app.iconPicker.search'))!.toBeInTheDocument()
      expect(screen.getByText(/tryYourLuck/i))!.toBeInTheDocument()
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

    it('randomizes emoji and background without submitting until confirmed', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const user = userEvent.setup()
      render(<EmojiPicker open onOpenChange={mockOnOpenChange} onSelect={mockOnSelect} />)
      await user.click(screen.getByRole('button', { name: /tryYourLuck/i }))
      expect(mockOnSelect).not.toHaveBeenCalled()
      expect(mockOnOpenChange).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /ok/i })).toBeEnabled()
      await user.click(screen.getByRole('button', { name: /ok/i }))
      expect(screen.getByRole('button', { name: '#FFF1F3' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(mockOnSelect).toHaveBeenCalledWith('😃', '#FFF1F3')
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
