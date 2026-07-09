import type { CustomCollectionBackend } from '../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthType } from '../../types'
import CustomCreateCard, { NewCustomToolButton } from '../custom-create-card'

const mockAppContextState = vi.hoisted(() => ({
  workspacePermissionKeys: ['tool.manage'] as string[],
  workspacePermissionKeysAtom: Symbol('workspacePermissionKeysAtom'),
}))

vi.mock('@/context/app-context-state', () => ({
  workspacePermissionKeysAtom: mockAppContextState.workspacePermissionKeysAtom,
}))

vi.mock('jotai', () => ({
  useAtomValue: (atom: unknown) => {
    if (atom === mockAppContextState.workspacePermissionKeysAtom)
      return mockAppContextState.workspacePermissionKeys

    throw new Error('Unexpected atom')
  },
}))

// Mock useLocale and useDocLink
vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
  useDocLink: () => (path?: string) => `https://docs.dify.ai/en${path?.startsWith('/use-dify/') ? `/cloud${path}` : path || ''}`,
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

// Mock toast
const mockToastSuccess = vi.fn()
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (title: string) => mockToastSuccess(title),
  },
}))

describe('CustomCreateCard', () => {
  const mockOnRefreshData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContextState.workspacePermissionKeys = ['tool.manage']
    mockModalVisible = false
    mockCreateCustomCollection.mockResolvedValue({})
  })

  describe('tool.manage conditional rendering', () => {
    it('should render card when user has tool.manage', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      expect(screen.getByText(/createSwaggerAPIAsTool/i)).toBeInTheDocument()
    })

    it('should not render anything when user does not have tool.manage', () => {
      mockAppContextState.workspacePermissionKeys = []

      const { container } = render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      expect(container.firstChild).toBeNull()
    })
  })

  // Tests for card rendering and styling
  describe('Card Rendering', () => {
    it('should render without crashing', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      expect(screen.getByText(/createSwaggerAPIAsTool/i)).toBeInTheDocument()
    })

    it('should render add icon', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // RiAddCircleFill icon should be present
      const iconContainer = document.querySelector('.size-10')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should have proper card styling', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const card = screen.getByText('tools.createSwaggerAPIAsTool').closest('.col-span-1')
      expect(card).toBeInTheDocument()
      expect(card).toHaveClass('h-[120px]', 'border-[0.5px]', 'border-components-panel-border', 'shadow-md')
      expect(card).toHaveClass('min-w-0')
      expect(card).not.toHaveClass('flex-1')
    })

    it('should render documentation link with Swagger API as Tool text', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const docLink = screen.getByText('tools.swaggerAPIAsToolTip').closest('a')
      expect(docLink).toHaveAttribute('href', 'https://docs.dify.ai/en/cloud/use-dify/workspace/tools#swagger-api')
      expect(docLink).toHaveAttribute('target', '_blank')
      expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('Toolbar Button Rendering', () => {
    it('should render toolbar add button when user has tool.manage', () => {
      render(<NewCustomToolButton onRefreshData={mockOnRefreshData} />)

      expect(screen.getByRole('button', { name: /tools\.addSwaggerAPIAsTool/i })).toBeInTheDocument()
    })

    it('should not render toolbar add button when user does not have tool.manage', () => {
      mockAppContextState.workspacePermissionKeys = []

      const { container } = render(<NewCustomToolButton onRefreshData={mockOnRefreshData} />)

      expect(container.firstChild).toBeNull()
    })

    it('should open modal when toolbar add button is clicked', () => {
      render(<NewCustomToolButton onRefreshData={mockOnRefreshData} />)

      fireEvent.click(screen.getByRole('button', { name: /tools\.addSwaggerAPIAsTool/i }))

      expect(screen.getByTestId('edit-custom-collection-modal')).toBeInTheDocument()
    })
  })

  // Tests for modal interaction
  describe('Modal Interaction', () => {
    it('should open modal when card is clicked', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Click on the card area (the group div)
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
      fireEvent.click(cardClickArea!)

      expect(screen.getByTestId('edit-custom-collection-modal')).toBeInTheDocument()
      expect(mockModalVisible).toBe(true)
    })

    it('should pass null payload to modal', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
      fireEvent.click(cardClickArea!)

      expect(screen.getByTestId('modal-payload')).toHaveTextContent('null')
    })

    it('should close modal when onHide is called', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
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
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
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
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
      fireEvent.click(cardClickArea!)

      // Submit form
      fireEvent.click(screen.getByTestId('submit-modal'))

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(expect.any(String))
      })
    })

    it('should close modal after successful creation', async () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
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
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
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
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
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
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
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
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
      fireEvent.click(cardClickArea!)

      // Close modal without submitting
      fireEvent.click(screen.getByTestId('close-modal'))

      expect(mockOnRefreshData).not.toHaveBeenCalled()
    })

    it('should handle rapid open/close of modal', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })

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

      const card = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
      expect(card).toBeInTheDocument()
      expect(card).toHaveClass('hover:bg-components-panel-on-panel-item-bg-hover')
    })

    it('should have group hover styles on icon container', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const iconContainer = document.querySelector('.group-hover\\:text-text-accent')
      expect(iconContainer).toBeInTheDocument()
    })
  })
})
