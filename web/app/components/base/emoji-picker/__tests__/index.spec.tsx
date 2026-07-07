import { act, fireEvent, render, screen } from '@testing-library/react'
import EmojiPicker from '../index'

vi.mock('@emoji-mart/data', () => ({
  default: {
    categories: [
      {
        id: 'category1',
        name: 'Category 1',
        emojis: ['emoji1', 'emoji2'],
      },
    ],
  },
}))

vi.mock('emoji-mart', () => ({
  init: vi.fn(),
  SearchIndex: {
    search: vi.fn().mockResolvedValue([{ skins: [{ native: '🔍' }] }]),
  },
}))

vi.mock('@/utils/emoji', () => ({
  searchEmoji: vi.fn().mockResolvedValue(['🔍']),
}))

describe('EmojiPicker', () => {
  const mockOnSelect = vi.fn()
  const mockOnOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders nothing when closed', () => {
      const { container } = render(
        <EmojiPicker open={false} onOpenChange={mockOnOpenChange} />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('renders modal when open', async () => {
      await act(async () => {
        render(
          <EmojiPicker open onOpenChange={mockOnOpenChange} />,
        )
      })
      expect(screen.getByRole('dialog', { name: /Emoji/i }))!.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Search emojis...'))!.toBeInTheDocument()
      expect(screen.getByText(/Cancel/i))!.toBeInTheDocument()
      expect(screen.getByText(/OK/i))!.toBeInTheDocument()
    })

    it('OK button is disabled initially', async () => {
      await act(async () => {
        render(
          <EmojiPicker open onOpenChange={mockOnOpenChange} />,
        )
      })
      const okButton = screen.getByText(/OK/i).closest('button')
      expect(okButton)!.toBeDisabled()
    })

    it('applies custom className to modal wrapper', async () => {
      const customClass = 'custom-wrapper-class'
      await act(async () => {
        render(
          <EmojiPicker open onOpenChange={mockOnOpenChange} className={customClass} />,
        )
      })
      const dialog = screen.getByRole('dialog')
      expect(dialog)!.toHaveClass(customClass)
    })
  })

  describe('User Interactions', () => {
    it('calls onSelect with selected emoji and background when OK is clicked', async () => {
      await act(async () => {
        render(
          <EmojiPicker open onOpenChange={mockOnOpenChange} onSelect={mockOnSelect} />,
        )
      })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'emoji1' }))
      })

      const okButton = screen.getByText(/OK/i)
      expect(okButton.closest('button')).not.toBeDisabled()

      await act(async () => {
        fireEvent.click(okButton)
      })

      expect(mockOnSelect).toHaveBeenCalledWith(expect.any(String), expect.any(String))
    })

    it('closes when Cancel is clicked', async () => {
      await act(async () => {
        render(
          <EmojiPicker open onOpenChange={mockOnOpenChange} />,
        )
      })

      const cancelButton = screen.getByText(/Cancel/i)
      await act(async () => {
        fireEvent.click(cancelButton)
      })

      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
