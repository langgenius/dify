import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import EmojiPickerInner from './Inner'

vi.mock('@emoji-mart/data', () => ({
  default: {
    categories: [
      {
        id: 'nature',
        emojis: ['rabbit', 'bear'],
      },
      {
        id: 'food',
        emojis: ['apple', 'orange'],
      },
    ],
  },
}))

vi.mock('emoji-mart', () => ({
  init: vi.fn(),
}))

vi.mock('@/utils/emoji', () => ({
  searchEmoji: vi.fn().mockResolvedValue(['dog', 'cat']),
}))

describe('EmojiPickerInner', () => {
  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Define the custom element to avoid "Unknown custom element" warnings
    if (!customElements.get('em-emoji')) {
      customElements.define('em-emoji', class extends HTMLElement {
        static get observedAttributes() { return ['id'] }
      })
    }
  })

  describe('Rendering', () => {
    it('renders initial categories and emojis correctly', () => {
      render(<EmojiPickerInner onSelect={mockOnSelect} />)

      expect(screen.getByText('nature')).toBeInTheDocument()
      expect(screen.getByText('food')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Search emojis...')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('calls searchEmoji and displays results when typing in search input', async () => {
      render(<EmojiPickerInner onSelect={mockOnSelect} />)
      const searchInput = screen.getByPlaceholderText('Search emojis...')

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'anim' } })
      })

      await waitFor(() => {
        expect(screen.getByText('Search')).toBeInTheDocument()
      })

      const searchSection = screen.getByText('Search').parentElement
      expect(searchSection?.querySelectorAll('em-emoji').length).toBe(2)
    })

    it('updates selected emoji and calls onSelect when an emoji is clicked', async () => {
      render(<EmojiPickerInner onSelect={mockOnSelect} />)
      const emojiContainers = screen.getAllByTestId(/^emoji-container-/)

      await act(async () => {
        fireEvent.click(emojiContainers[0])
      })

      expect(mockOnSelect).toHaveBeenCalledWith('rabbit', expect.any(String))
    })

    it('toggles style colors display when clicking the chevron', async () => {
      render(<EmojiPickerInner onSelect={mockOnSelect} />)

      expect(screen.queryByText('#FFEAD5')).not.toBeInTheDocument()

      const toggleButton = screen.getByTestId('toggle-colors')
      expect(toggleButton).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(toggleButton!)
      })

      expect(screen.getByText('Choose Style')).toBeInTheDocument()
      const colorOptions = document.querySelectorAll('[style^="background:"]')
      expect(colorOptions.length).toBeGreaterThan(0)
    })

    it('updates background color and calls onSelect when a color is clicked', async () => {
      render(<EmojiPickerInner onSelect={mockOnSelect} />)

      const toggleButton = screen.getByTestId('toggle-colors')
      await act(async () => {
        fireEvent.click(toggleButton!)
      })

      const emojiContainers = screen.getAllByTestId(/^emoji-container-/)
      await act(async () => {
        fireEvent.click(emojiContainers[0])
      })

      mockOnSelect.mockClear()

      const colorOptions = document.querySelectorAll('[style^="background:"]')
      await act(async () => {
        fireEvent.click(colorOptions[1].parentElement!)
      })

      expect(mockOnSelect).toHaveBeenCalledWith('rabbit', '#E4FBCC')
    })

    it('updates selected emoji when clicking a search result', async () => {
      render(<EmojiPickerInner onSelect={mockOnSelect} />)
      const searchInput = screen.getByPlaceholderText('Search emojis...')

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'anim' } })
      })

      await screen.findByText('Search')

      const searchEmojis = screen.getAllByTestId(/^emoji-search-result-/)
      await act(async () => {
        fireEvent.click(searchEmojis![0])
      })

      expect(mockOnSelect).toHaveBeenCalledWith('dog', expect.any(String))
    })

    it('toggles style colors display back and forth', async () => {
      render(<EmojiPickerInner onSelect={mockOnSelect} />)

      const toggleButton = screen.getByTestId('toggle-colors')

      await act(async () => {
        fireEvent.click(toggleButton!)
      })
      expect(screen.getByText('Choose Style')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByTestId('toggle-colors')!) // It should be the other icon now
      })
      expect(screen.queryByText('#FFEAD5')).not.toBeInTheDocument()
    })

    it('clears search results when input is cleared', async () => {
      render(<EmojiPickerInner onSelect={mockOnSelect} />)
      const searchInput = screen.getByPlaceholderText('Search emojis...')

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'anim' } })
      })

      await screen.findByText('Search')

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: '' } })
      })

      expect(screen.queryByText('Search')).not.toBeInTheDocument()
    })
  })
})
