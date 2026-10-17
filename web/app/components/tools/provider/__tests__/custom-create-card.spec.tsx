import type { CustomCollectionBackend } from '../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@/test/console/render'
import { AuthType } from '../../types'
import CustomCreateCard, { NewCustomToolButton } from '../custom-create-card'

const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['tool.manage'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

// Mock useLocale and useDocLink
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => 'en-US',
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) =>
    `https://docs.dify.ai/en${path?.startsWith('/use-dify/') ? `/cloud${path}` : path || ''}`,
}))

// Mock getPluginLanguage
vi.mock('@/i18n/metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/metadata')>()),
  getPluginLanguage: () => 'en-US',
}))

// Mock createCustomCollection service
const mockCreateCustomCollection = vi.fn()
vi.mock('@/service/tools', () => ({
  createCustomCollection: (data: CustomCollectionBackend) => mockCreateCustomCollection(data),
}))

// Track modal state

// Mock EditCustomToolModal - complex component
vi.mock('@/app/components/tools/edit-custom-collection-modal', () => ({
  default: ({
    payload,
    onHide,
    onAdd,
  }: {
    payload: null
    onHide: () => void
    onAdd: (data: CustomCollectionBackend) => void
  }) => {
    void onAdd // Keep reference to avoid lint warning about unused param
    return (
      <div data-testid="edit-custom-collection-modal">
        <span data-testid="modal-payload">{payload === null ? 'null' : 'not-null'}</span>
        <button data-testid="close-modal" onClick={onHide}>
          Close
        </button>
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
vi.mock('@/app/notifications', () => ({
  toast: {
    success: (title: string) => mockToastSuccess(title),
  },
}))

describe('CustomCreateCard', () => {
  const mockOnRefreshData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState.workspacePermissionKeys = ['tool.manage']
    mockCreateCustomCollection.mockResolvedValue({})
  })

  describe('tool.manage conditional rendering', () => {
    it('should not render anything when user does not have tool.manage', () => {
      mockConsoleState.workspacePermissionKeys = []

      const { container } = render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      expect(container.firstChild).toBeNull()
    })
  })

  // Tests for card rendering and styling
  describe('Card Rendering', () => {
    it('should render documentation link with Swagger API as Tool text', () => {
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      const docLink = screen.getByText('tools.swaggerAPIAsToolTip').closest('a')
      expect(docLink).toHaveAttribute(
        'href',
        'https://docs.dify.ai/en/cloud/use-dify/workspace/tools#swagger-api',
      )
      expect(docLink).toHaveAttribute('target', '_blank')
      expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('Toolbar Button Rendering', () => {
    it('should not render toolbar add button when user does not have tool.manage', () => {
      mockConsoleState.workspacePermissionKeys = []

      const { container } = render(<NewCustomToolButton onRefreshData={mockOnRefreshData} />)

      expect(container.firstChild).toBeNull()
    })

    it('should open modal when toolbar add button is clicked', async () => {
      const user = userEvent.setup()
      render(<NewCustomToolButton onRefreshData={mockOnRefreshData} />)

      await user.click(screen.getByRole('button', { name: /tools\.addSwaggerAPIAsTool/i }))

      expect(screen.getByTestId('edit-custom-collection-modal')).toBeInTheDocument()
    })
  })

  // Tests for modal interaction

  // Tests for custom collection creation
  describe('Custom Collection Creation', () => {
    it('should call createCustomCollection when form is submitted', async () => {
      const user = userEvent.setup()
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
      await user.click(cardClickArea!)

      // Submit form
      await user.click(screen.getByTestId('submit-modal'))

      await waitFor(() => {
        expect(mockCreateCustomCollection).toHaveBeenCalledExactlyOnceWith({
          provider: 'test-provider',
          credentials: { auth_type: AuthType.none },
          icon: { background: '#000', content: '🔧' },
          schema_type: 'json',
          schema: '{}',
          privacy_policy: '',
          custom_disclaimer: '',
          labels: [],
        })
        expect(mockOnRefreshData).toHaveBeenCalledOnce()
        expect(screen.queryByTestId('edit-custom-collection-modal')).not.toBeInTheDocument()
      })
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should not call onRefreshData if modal is just closed without submitting', async () => {
      const user = userEvent.setup()
      render(<CustomCreateCard onRefreshData={mockOnRefreshData} />)

      // Open modal
      const cardClickArea = screen.getByRole('button', { name: 'tools.createSwaggerAPIAsTool' })
      await user.click(cardClickArea!)

      // Close modal without submitting
      await user.click(screen.getByTestId('close-modal'))

      expect(mockOnRefreshData).not.toHaveBeenCalled()
      expect(mockCreateCustomCollection).not.toHaveBeenCalled()
      expect(screen.queryByTestId('edit-custom-collection-modal')).not.toBeInTheDocument()
    })
  })

  // Tests for hover styling
})
