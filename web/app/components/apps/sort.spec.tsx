import { fireEvent, render, screen } from '@testing-library/react'
import SortDropdown from './sort'
import type { SortBy } from './hooks/use-apps-query-state'

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('SortDropdown', () => {
  const mockOnChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<SortDropdown onChange={mockOnChange} />)
      expect(screen.getByText('app.sort.sortBy')).toBeInTheDocument()
    })

    it('should display current sort option when sortBy is provided', () => {
      render(<SortDropdown sortBy="name" sortOrder="asc" onChange={mockOnChange} />)
      expect(screen.getByText('Flow Name')).toBeInTheDocument()
    })

    it('should display ascending icon when sortOrder is asc', () => {
      render(<SortDropdown sortBy="name" sortOrder="asc" onChange={mockOnChange} />)
      const buttons = screen.getAllByRole('button')
      const orderButton = buttons[1]
      expect(orderButton).toHaveAttribute('title', 'Ascending')
    })

    it('should display descending icon when sortOrder is desc', () => {
      render(<SortDropdown sortBy="name" sortOrder="desc" onChange={mockOnChange} />)
      const buttons = screen.getAllByRole('button')
      const orderButton = buttons[1]
      expect(orderButton).toHaveAttribute('title', 'Descending')
    })
  })

  describe('User Interactions', () => {
    it('should cycle to next sort option when sort button is clicked', () => {
      // Initial state: created_at (index 0)
      const { rerender } = render(<SortDropdown sortBy="created_at" onChange={mockOnChange} />)
      const sortButton = screen.getAllByRole('button')[0]

      // Click to cycle to updated_at (index 1)
      fireEvent.click(sortButton)
      expect(mockOnChange).toHaveBeenCalledWith('updated_at', 'desc')

      // Update props to simulate state change
      rerender(<SortDropdown sortBy="updated_at" onChange={mockOnChange} />)
      fireEvent.click(sortButton)
      expect(mockOnChange).toHaveBeenCalledWith('name', 'desc')

      // Update props
      rerender(<SortDropdown sortBy="name" onChange={mockOnChange} />)
      fireEvent.click(sortButton)
      expect(mockOnChange).toHaveBeenCalledWith('owner_name', 'desc')

      // Update props
      rerender(<SortDropdown sortBy="owner_name" onChange={mockOnChange} />)
      fireEvent.click(sortButton)
      expect(mockOnChange).toHaveBeenCalledWith('created_at', 'desc')
    })

    it('should toggle sort order when order button is clicked', () => {
      render(<SortDropdown sortBy="name" sortOrder="asc" onChange={mockOnChange} />)
      const orderButton = screen.getAllByRole('button')[1]

      fireEvent.click(orderButton)
      expect(mockOnChange).toHaveBeenCalledWith('name', 'desc')
    })

    it('should toggle sort order back to asc when clicked again', () => {
      render(<SortDropdown sortBy="name" sortOrder="desc" onChange={mockOnChange} />)
      const orderButton = screen.getAllByRole('button')[1]

      fireEvent.click(orderButton)
      expect(mockOnChange).toHaveBeenCalledWith('name', 'asc')
    })
  })

  describe('Props Testing', () => {
    it('should handle all sort options', () => {
      const sortOptions: Array<{ sortBy: SortBy; label: string }> = [
        { sortBy: 'created_at', label: 'app.sort.createdAt' },
        { sortBy: 'updated_at', label: 'app.sort.updatedAt' },
        { sortBy: 'name', label: 'Flow Name' },
        { sortBy: 'owner_name', label: 'app.sort.ownerName' },
      ]

      sortOptions.forEach(({ sortBy, label }) => {
        const { unmount } = render(<SortDropdown sortBy={sortBy} sortOrder="desc" onChange={mockOnChange} />)
        expect(screen.getByText(label)).toBeInTheDocument()
        unmount()
      })
    })
  })
})
