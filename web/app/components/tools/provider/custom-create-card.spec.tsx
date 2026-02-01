import type { CustomCollectionBackend } from '../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthType } from '../types'
import CustomCreateCard from './custom-create-card'

// Mock workspace manager state
let mockIsWorkspaceManager = true

// Mock useAppContext
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsWorkspaceManager,
  }),
}))

// Mock useLocale and useDocLink
vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
  useDocLink: () => (path: string) => `https://docs.dify.ai/en/${path?.startsWith('/') ? path.slice(1) : path}`,
}))

// Mock getLanguage
vi.mock('@/i18n-config/language', () => ({
  getLanguage: () => 'en-US',
}))

// Mock createCustomCollection service
const mockCreateCustomCollection = vi.fn()
vi.mock('@/service/tools', () => ({
  createCustomCollection: (data: CustomCollectionBackend) => mockCreateCustomCollection(data),
}))

// Track modal state
let mockModalVisible = false

// Mock EditCustomToolModal - complex component
vi.mock('@/app/components/tools/edit-custom-collection-modal', () => ({
  default: ({ payload, onHide, onAdd }: {
    payload: null
    onHide: () => void
    onAdd: (data: CustomCollectionBackend) => void
  }) => {
    mockModalVisible = true
    void onAdd // Keep reference to avoid lint warning about unused param
    return (
      <div data-testid="edit-custom-collection-modal">
        <span data-testid="modal-payload">{payload === null ? 'null' : 'not-null'}</span>
        <button data-testid="close-modal" onClick={onHide}>Close</button>
        <button
          data-testid="submit-modal"
          onClick={() => {
            onAdd({
              provider: 'test-provider',
              credentials: { auth_type: AuthType.none },
              icon: { background: '#000', content: '🔧' },
              schema_type: 'json',
              schema: '{}',
              privacy_policy: '',
              custom_disclaimer: '',
              id: 'test-id',
              labels: [],
            })
          }}
        >
          Submit
        </button>
      </div>
    )
  },
}))

// Mock Toast
const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (options: { type: string, message: string }) => mockToastNotify(options),
  },
}))

describe('CustomCreateCard', () => {
  const mockOnRefreshData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsWorkspaceManager = true
    mockModalVisible = false
    mockCreateCustomCollection.mockResolvedValue({})
  })

  // Tests for conditional rendering based on workspace manager status
  describe('Workspace Manager Conditional Rendering', () => {
    it('should render card when user is workspace manager', () => {
      mockIsWorkspaceManager = true

      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Card should be visible with create text
      expect(screen.getByText(/createCustomTool/i)).toBeInTheDocument()
    })

    it('should not render anything when user is not workspace manager', () => {
      mockIsWorkspaceManager = false

      const { container } = render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Container should be empty (firstChild is null when nothing renders)
      expect(container.firstChild).toBeNull()
    })
  })

  // Tests for card rendering and styling
  describe('Card Rendering', () => {
    it('should render without crashing', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      expect(screen.getByText(/createCustomTool/i)).toBeInTheDocument()
    })

    it('should render add icon', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // RiAddCircleFill icon should be present
      const iconContainer = document.querySelector('.h-10.w-10')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should have proper card styling', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const card = document.querySelector('.min-h-\\[135px\\]')
      expect(card).toBeInTheDocument()
      expect(card).toHaveClass('cursor-pointer')
    })
  })

  // Tests for modal interaction
  describe('Modal Interaction', () => {
    it('should open modal when card is clicked', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Click on the card area (the group div)
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)

      expect(screen.getByTestId('edit-custom-collection-modal')).toBeInTheDocument()
      expect(mockModalVisible).toBe(true)
    })

    it('should pass null payload to modal', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)

      expect(screen.getByTestId('modal-payload')).toHaveTextContent('null')
    })

    it('should close modal when onHide is called', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)
      expect(screen.getByTestId('edit-custom-collection-modal')).toBeInTheDocument()

      // Close modal
      fireEvent.click(screen.getByTestId('close-modal'))
      expect(screen.queryByTestId('edit-custom-collection-modal')).not.toBeInTheDocument()
    })
  })

  // Tests for custom collection creation
  describe('Custom Collection Creation', () => {
    it('should call createCustomCollection when form is submitted', async () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)

      // Submit form
      fireEvent.click(screen.getByTestId('submit-modal'))

      await waitFor(() => {
        expect(mockCreateCustomCollection).toHaveBeenCalledTimes(1)
      })
    })

    it('should show success toast after successful creation', async () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)

      // Submit form
      fireEvent.click(screen.getByTestId('submit-modal'))

      await waitFor(() => {
        expect(mockToastNotify).toHaveBeenCalledWith({
          type: 'success',
          message: expect.any(String),
        })
      })
    })

    it('should close modal after successful creation', async () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)
      expect(screen.getByTestId('edit-custom-collection-modal')).toBeInTheDocument()

      // Submit form
      fireEvent.click(screen.getByTestId('submit-modal'))

      await waitFor(() => {
        expect(screen.queryByTestId('edit-custom-collection-modal')).not.toBeInTheDocument()
      })
    })

    it('should call onRefreshData after successful creation', async () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)

      // Submit form
      fireEvent.click(screen.getByTestId('submit-modal'))

      await waitFor(() => {
        expect(mockOnRefreshData).toHaveBeenCalledTimes(1)
      })
    })

    it('should pass correct data to createCustomCollection', async () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)

      // Submit form
      fireEvent.click(screen.getByTestId('submit-modal'))

      await waitFor(() => {
        expect(mockCreateCustomCollection).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'test-provider',
            schema_type: 'json',
          }),
        )
      })
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should call createCustomCollection and handle successful response', async () => {
      mockCreateCustomCollection.mockResolvedValue({ success: true })

      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)

      // Submit form
      fireEvent.click(screen.getByTestId('submit-modal'))

      // The API should be called
      await waitFor(() => {
        expect(mockCreateCustomCollection).toHaveBeenCalled()
      })

      // And refresh should be triggered
      await waitFor(() => {
        expect(mockOnRefreshData).toHaveBeenCalled()
      })
    })

    it('should not call onRefreshData if modal is just closed without submitting', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = document.querySelector('.group.grow')
      fireEvent.click(cardClickArea!)

      // Close modal without submitting
      fireEvent.click(screen.getByTestId('close-modal'))

      expect(mockOnRefreshData).not.toHaveBeenCalled()
    })

    it('should handle rapid open/close of modal', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const cardClickArea = document.querySelector('.group.grow')

      // Rapid open/close
      fireEvent.click(cardClickArea!)
      fireEvent.click(screen.getByTestId('close-modal'))
      fireEvent.click(cardClickArea!)

      expect(screen.getByTestId('edit-custom-collection-modal')).toBeInTheDocument()
    })
  })

  // Tests for hover styling
  describe('Hover Styling', () => {
    it('should have hover styles on card', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const card = document.querySelector('.transition-all.duration-200')
      expect(card).toBeInTheDocument()
    })

    it('should have group hover styles on icon container', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const iconContainer = document.querySelector('.group-hover\\:border-state-accent-hover-alt')
      expect(iconContainer).toBeInTheDocument()
    })
  })
})
