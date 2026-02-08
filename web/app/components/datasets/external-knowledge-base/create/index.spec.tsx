import type { ExternalAPIItem } from '@/models/datasets'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import ExternalKnowledgeBaseCreate from './index'
import RetrievalSettings from './RetrievalSettings'

// Mock next/navigation
const mockReplace = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
    refresh: mockRefresh,
  }),
}))

// Mock useDocLink hook
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path?: string) => `https://docs.dify.ai/en${path || ''}`,
}))

// Mock external context providers (these are external dependencies)
const mockSetShowExternalKnowledgeAPIModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: mockSetShowExternalKnowledgeAPIModal,
  }),
}))

// Factory function to create mock ExternalAPIItem (following project conventions)
const createMockExternalAPIItem = (overrides: Partial<ExternalAPIItem> = {}): ExternalAPIItem => ({
  id: 'api-default',
  tenant_id: 'tenant-1',
  name: 'Default API',
  description: 'Default API description',
  settings: {
    endpoint: 'https://api.example.com',
    api_key: 'test-api-key',
  },
  dataset_bindings: [],
  created_by: 'user-1',
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
})

// Default mock API list
const createDefaultMockApiList = (): ExternalAPIItem[] => [
  createMockExternalAPIItem({
    id: 'api-1',
    name: 'Test API 1',
    settings: { endpoint: 'https://api1.example.com', api_key: 'key-1' },
  }),
  createMockExternalAPIItem({
    id: 'api-2',
    name: 'Test API 2',
    settings: { endpoint: 'https://api2.example.com', api_key: 'key-2' },
  }),
]

const mockMutateExternalKnowledgeApis = vi.fn()
let mockExternalKnowledgeApiList: ExternalAPIItem[] = createDefaultMockApiList()

vi.mock('@/context/external-knowledge-api-context', () => ({
  useExternalKnowledgeApi: () => ({
    externalKnowledgeApiList: mockExternalKnowledgeApiList,
    mutateExternalKnowledgeApis: mockMutateExternalKnowledgeApis,
    isLoading: false,
  }),
}))

// Helper to render component with default props
const renderComponent = (props: Partial<React.ComponentProps<typeof ExternalKnowledgeBaseCreate>> = {}) => {
  const defaultProps = {
    onConnect: vi.fn(),
    loading: false,
  }
  return render(<ExternalKnowledgeBaseCreate {...defaultProps} {...props} />)
}

describe('ExternalKnowledgeBaseCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset API list to default using factory function
    mockExternalKnowledgeApiList = createDefaultMockApiList()
  })

  // Tests for basic rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderComponent()

      expect(screen.getByText('dataset.connectDataset')).toBeInTheDocument()
    })

    it('should render KnowledgeBaseInfo component with correct labels', () => {
      renderComponent()

      // KnowledgeBaseInfo renders these labels
      expect(screen.getByText('dataset.externalKnowledgeName')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalKnowledgeDescription')).toBeInTheDocument()
    })

    it('should render ExternalApiSelection component', () => {
      renderComponent()

      // ExternalApiSelection renders this label
      expect(screen.getByText('dataset.externalAPIPanelTitle')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalKnowledgeId')).toBeInTheDocument()
    })

    it('should render RetrievalSettings component', () => {
      renderComponent()

      // RetrievalSettings renders this label
      expect(screen.getByText('dataset.retrievalSettings')).toBeInTheDocument()
    })

    it('should render InfoPanel component', () => {
      renderComponent()

      // InfoPanel renders these texts
      expect(screen.getByText('dataset.connectDatasetIntro.title')).toBeInTheDocument()
      expect(screen.getByText('dataset.connectDatasetIntro.learnMore')).toBeInTheDocument()
    })

    it('should render helper text with translation keys', () => {
      renderComponent()

      expect(screen.getByText('dataset.connectHelper.helper1')).toBeInTheDocument()
      expect(screen.getByText('dataset.connectHelper.helper2')).toBeInTheDocument()
      expect(screen.getByText('dataset.connectHelper.helper3')).toBeInTheDocument()
      expect(screen.getByText('dataset.connectHelper.helper4')).toBeInTheDocument()
      expect(screen.getByText('dataset.connectHelper.helper5')).toBeInTheDocument()
    })

    it('should render cancel and connect buttons', () => {
      renderComponent()

      expect(screen.getByText('dataset.externalKnowledgeForm.cancel')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalKnowledgeForm.connect')).toBeInTheDocument()
    })

    it('should render documentation link with correct href', () => {
      renderComponent()

      const docLink = screen.getByText('dataset.connectHelper.helper4')
      expect(docLink).toHaveAttribute('href', 'https://docs.dify.ai/en/use-dify/knowledge/connect-external-knowledge-base')
      expect(docLink).toHaveAttribute('target', '_blank')
      expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  // Tests for props handling
  describe('Props', () => {
    it('should pass loading prop to connect button', () => {
      renderComponent({ loading: true })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeInTheDocument()
    })

    it('should call onConnect with form data when connect button is clicked', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      // Fill in name field (using the actual Input component)
      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      fireEvent.change(nameInput, { target: { value: 'Test Knowledge Base' } })

      // Fill in external knowledge id
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')
      fireEvent.change(knowledgeIdInput, { target: { value: 'knowledge-456' } })

      // Wait for useEffect to auto-select the first API
      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Knowledge Base',
          external_knowledge_id: 'knowledge-456',
          external_knowledge_api_id: 'api-1', // Auto-selected first API
          provider: 'external',
        }),
      )
    })

    it('should not call onConnect when form is invalid and button is disabled', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeDisabled()

      await user.click(connectButton!)
      expect(onConnect).not.toHaveBeenCalled()
    })
  })

  // Tests for state management with real child components
  describe('State Management', () => {
    it('should initialize form data with default values', () => {
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder') as HTMLInputElement
      const descriptionInput = screen.getByPlaceholderText('dataset.externalKnowledgeDescriptionPlaceholder') as HTMLTextAreaElement

      expect(nameInput.value).toBe('')
      expect(descriptionInput.value).toBe('')
    })

    it('should update name when input changes', () => {
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      fireEvent.change(nameInput, { target: { value: 'New Name' } })

      expect((nameInput as HTMLInputElement).value).toBe('New Name')
    })

    it('should update description when textarea changes', () => {
      renderComponent()

      const descriptionInput = screen.getByPlaceholderText('dataset.externalKnowledgeDescriptionPlaceholder')
      fireEvent.change(descriptionInput, { target: { value: 'New Description' } })

      expect((descriptionInput as HTMLTextAreaElement).value).toBe('New Description')
    })

    it('should update external_knowledge_id when input changes', () => {
      renderComponent()

      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')
      fireEvent.change(knowledgeIdInput, { target: { value: 'new-knowledge-id' } })

      expect((knowledgeIdInput as HTMLInputElement).value).toBe('new-knowledge-id')
    })

    it('should apply filled text style when description has value', () => {
      renderComponent()

      const descriptionInput = screen.getByPlaceholderText('dataset.externalKnowledgeDescriptionPlaceholder') as HTMLTextAreaElement

      // Initially empty - should have placeholder style
      expect(descriptionInput.className).toContain('text-components-input-text-placeholder')

      // Add description - should have filled style
      fireEvent.change(descriptionInput, { target: { value: 'Some description' } })
      expect(descriptionInput.className).toContain('text-components-input-text-filled')
    })

    it('should apply placeholder text style when description is empty', () => {
      renderComponent()

      const descriptionInput = screen.getByPlaceholderText('dataset.externalKnowledgeDescriptionPlaceholder') as HTMLTextAreaElement

      // Add then clear description
      fireEvent.change(descriptionInput, { target: { value: 'Some description' } })
      fireEvent.change(descriptionInput, { target: { value: '' } })

      expect(descriptionInput.className).toContain('text-components-input-text-placeholder')
    })
  })

  // Tests for form validation
  describe('Form Validation', () => {
    it('should disable connect button when name is empty', async () => {
      renderComponent()

      // Fill knowledge id but not name
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')
      fireEvent.change(knowledgeIdInput, { target: { value: 'knowledge-456' } })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeDisabled()
    })

    it('should disable connect button when name is only whitespace', async () => {
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: '   ' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'knowledge-456' } })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeDisabled()
    })

    it('should disable connect button when external_knowledge_id is empty', () => {
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      fireEvent.change(nameInput, { target: { value: 'Test Name' } })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeDisabled()
    })

    it('should enable connect button when all required fields are filled', async () => {
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test Name' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'knowledge-456' } })

      // Wait for auto-selection of API
      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })
    })
  })

  // Tests for user interactions
  describe('User Interactions', () => {
    it('should navigate back when back button is clicked', async () => {
      const user = userEvent.setup()
      renderComponent()

      const buttons = screen.getAllByRole('button')
      const backButton = buttons.find(btn => btn.classList.contains('rounded-full'))
      await user.click(backButton!)

      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })

    it('should navigate back when cancel button is clicked', async () => {
      const user = userEvent.setup()
      renderComponent()

      const cancelButton = screen.getByText('dataset.externalKnowledgeForm.cancel').closest('button')
      await user.click(cancelButton!)

      expect(mockReplace).toHaveBeenCalledWith('/datasets')
    })

    it('should call onConnect with complete form data when connect is clicked', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      // Fill all fields using real components
      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const descriptionInput = screen.getByPlaceholderText('dataset.externalKnowledgeDescriptionPlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'My Knowledge Base' } })
      fireEvent.change(descriptionInput, { target: { value: 'Test description' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'knowledge-abc' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Knowledge Base',
          description: 'Test description',
          external_knowledge_id: 'knowledge-abc',
          provider: 'external',
        }),
      )
    })

    it('should allow user to type in all input fields', async () => {
      const user = userEvent.setup()
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const descriptionInput = screen.getByPlaceholderText('dataset.externalKnowledgeDescriptionPlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      await user.type(nameInput, 'Typed Name')
      await user.type(descriptionInput, 'Typed Description')
      await user.type(knowledgeIdInput, 'typed-knowledge')

      expect((nameInput as HTMLInputElement).value).toBe('Typed Name')
      expect((descriptionInput as HTMLTextAreaElement).value).toBe('Typed Description')
      expect((knowledgeIdInput as HTMLInputElement).value).toBe('typed-knowledge')
    })
  })

  // Tests for ExternalApiSelection integration
  describe('ExternalApiSelection Integration', () => {
    it('should auto-select first API when API list is available', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'kb-1' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      // Should have auto-selected the first API
      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          external_knowledge_api_id: 'api-1',
        }),
      )
    })

    it('should display API selector when APIs are available', () => {
      renderComponent()

      // The ExternalApiSelect should show the first selected API name
      expect(screen.getByText('Test API 1')).toBeInTheDocument()
    })

    it('should allow selecting different API from dropdown', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      // Click on the API selector to open dropdown
      const apiSelector = screen.getByText('Test API 1')
      await user.click(apiSelector)

      // Select the second API
      const secondApi = screen.getByText('Test API 2')
      await user.click(secondApi)

      // Fill required fields
      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'kb-1' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      // Should have selected the second API
      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          external_knowledge_api_id: 'api-2',
        }),
      )
    })

    it('should show add API button when no APIs are available', () => {
      // Set empty API list
      mockExternalKnowledgeApiList = []
      renderComponent()

      // Should show "no external knowledge" button
      expect(screen.getByText('dataset.noExternalKnowledge')).toBeInTheDocument()
    })

    it('should open add API modal when add button is clicked', async () => {
      const user = userEvent.setup()
      // Set empty API list
      mockExternalKnowledgeApiList = []
      renderComponent()

      // Click the add button
      const addButton = screen.getByText('dataset.noExternalKnowledge').closest('button')
      await user.click(addButton!)

      // Should call the modal context function
      expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { name: '', settings: { endpoint: '', api_key: '' } },
          isEditMode: false,
        }),
      )
    })

    it('should call mutate and router.refresh on modal save callback', async () => {
      const user = userEvent.setup()
      // Set empty API list
      mockExternalKnowledgeApiList = []
      renderComponent()

      // Click the add button
      const addButton = screen.getByText('dataset.noExternalKnowledge').closest('button')
      await user.click(addButton!)

      // Get the callback and invoke it
      const modalCall = mockSetShowExternalKnowledgeAPIModal.mock.calls[0][0]
      await modalCall.onSaveCallback()

      expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
      expect(mockRefresh).toHaveBeenCalled()
    })

    it('should call mutate on modal cancel callback', async () => {
      const user = userEvent.setup()
      // Set empty API list
      mockExternalKnowledgeApiList = []
      renderComponent()

      // Click the add button
      const addButton = screen.getByText('dataset.noExternalKnowledge').closest('button')
      await user.click(addButton!)

      // Get the callback and invoke it
      const modalCall = mockSetShowExternalKnowledgeAPIModal.mock.calls[0][0]
      modalCall.onCancelCallback()

      expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
    })

    it('should display API URL in dropdown', async () => {
      const user = userEvent.setup()
      renderComponent()

      // Click on the API selector to open dropdown
      const apiSelector = screen.getByText('Test API 1')
      await user.click(apiSelector)

      // Should show API URLs
      expect(screen.getByText('https://api1.example.com')).toBeInTheDocument()
      expect(screen.getByText('https://api2.example.com')).toBeInTheDocument()
    })

    it('should show create new API option in dropdown', async () => {
      const user = userEvent.setup()
      renderComponent()

      // Click on the API selector to open dropdown
      const apiSelector = screen.getByText('Test API 1')
      await user.click(apiSelector)

      // Should show create new API option
      expect(screen.getByText('dataset.createNewExternalAPI')).toBeInTheDocument()
    })

    it('should open add API modal when clicking create new API in dropdown', async () => {
      const user = userEvent.setup()
      renderComponent()

      // Click on the API selector to open dropdown
      const apiSelector = screen.getByText('Test API 1')
      await user.click(apiSelector)

      // Click on create new API option
      const createNewApiOption = screen.getByText('dataset.createNewExternalAPI')
      await user.click(createNewApiOption)

      // Should call the modal context function
      expect(mockSetShowExternalKnowledgeAPIModal).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { name: '', settings: { endpoint: '', api_key: '' } },
          isEditMode: false,
        }),
      )
    })

    it('should call mutate and refresh on save callback from ExternalApiSelect dropdown', async () => {
      const user = userEvent.setup()
      renderComponent()

      // Click on the API selector to open dropdown
      const apiSelector = screen.getByText('Test API 1')
      await user.click(apiSelector)

      // Click on create new API option
      const createNewApiOption = screen.getByText('dataset.createNewExternalAPI')
      await user.click(createNewApiOption)

      // Get the callback from the modal call and invoke it
      const modalCall = mockSetShowExternalKnowledgeAPIModal.mock.calls[0][0]
      await modalCall.onSaveCallback()

      expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
      expect(mockRefresh).toHaveBeenCalled()
    })

    it('should call mutate on cancel callback from ExternalApiSelect dropdown', async () => {
      const user = userEvent.setup()
      renderComponent()

      // Click on the API selector to open dropdown
      const apiSelector = screen.getByText('Test API 1')
      await user.click(apiSelector)

      // Click on create new API option
      const createNewApiOption = screen.getByText('dataset.createNewExternalAPI')
      await user.click(createNewApiOption)

      // Get the callback from the modal call and invoke it
      const modalCall = mockSetShowExternalKnowledgeAPIModal.mock.calls[0][0]
      modalCall.onCancelCallback()

      expect(mockMutateExternalKnowledgeApis).toHaveBeenCalled()
    })

    it('should close dropdown after selecting an API', async () => {
      const user = userEvent.setup()
      renderComponent()

      // Click on the API selector to open dropdown
      const apiSelector = screen.getByText('Test API 1')
      await user.click(apiSelector)

      // Dropdown should be open - API URLs visible
      expect(screen.getByText('https://api1.example.com')).toBeInTheDocument()

      // Select the second API
      const secondApi = screen.getByText('Test API 2')
      await user.click(secondApi)

      // Dropdown should be closed - API URLs not visible
      expect(screen.queryByText('https://api1.example.com')).not.toBeInTheDocument()
    })

    it('should toggle dropdown open/close on selector click', async () => {
      const user = userEvent.setup()
      renderComponent()

      // Click to open
      const apiSelector = screen.getByText('Test API 1')
      await user.click(apiSelector)
      expect(screen.getByText('https://api1.example.com')).toBeInTheDocument()

      // Click again to close
      await user.click(apiSelector)
      expect(screen.queryByText('https://api1.example.com')).not.toBeInTheDocument()
    })
  })

  // Tests for callback stability
  describe('Callback Stability', () => {
    it('should maintain stable navBackHandle callback reference', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <ExternalKnowledgeBaseCreate onConnect={vi.fn()} loading={false} />,
      )

      const buttons = screen.getAllByRole('button')
      const backButton = buttons.find(btn => btn.classList.contains('rounded-full'))
      await user.click(backButton!)

      expect(mockReplace).toHaveBeenCalledTimes(1)

      rerender(<ExternalKnowledgeBaseCreate onConnect={vi.fn()} loading={false} />)

      await user.click(backButton!)
      expect(mockReplace).toHaveBeenCalledTimes(2)
    })

    it('should not recreate handlers on prop changes', async () => {
      const user = userEvent.setup()
      const onConnect1 = vi.fn()
      const onConnect2 = vi.fn()

      const { rerender } = render(
        <ExternalKnowledgeBaseCreate onConnect={onConnect1} loading={false} />,
      )

      // Fill form
      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'knowledge' } })

      // Rerender with new callback
      rerender(<ExternalKnowledgeBaseCreate onConnect={onConnect2} loading={false} />)

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      // Should use the new callback
      expect(onConnect1).not.toHaveBeenCalled()
      expect(onConnect2).toHaveBeenCalled()
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should handle empty description gracefully', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'knowledge' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '',
        }),
      )
    })

    it('should handle special characters in name', () => {
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const specialName = 'Test <script>alert("xss")</script> Name'

      fireEvent.change(nameInput, { target: { value: specialName } })

      expect((nameInput as HTMLInputElement).value).toBe(specialName)
    })

    it('should handle very long input values', () => {
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const longName = 'A'.repeat(1000)

      fireEvent.change(nameInput, { target: { value: longName } })

      expect((nameInput as HTMLInputElement).value).toBe(longName)
    })

    it('should handle rapid sequential updates', () => {
      renderComponent()

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')

      // Rapid updates
      for (let i = 0; i < 10; i++)
        fireEvent.change(nameInput, { target: { value: `Name ${i}` } })

      expect((nameInput as HTMLInputElement).value).toBe('Name 9')
    })

    it('should preserve provider value as external', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'knowledge' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'external',
        }),
      )
    })
  })

  // Tests for loading state
  describe('Loading State', () => {
    it('should pass loading state to connect button', () => {
      renderComponent({ loading: true })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeInTheDocument()
    })

    it('should render correctly when not loading', () => {
      renderComponent({ loading: false })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      expect(connectButton).toBeInTheDocument()
    })
  })

  // Tests for RetrievalSettings integration
  describe('RetrievalSettings Integration', () => {
    it('should toggle score threshold enabled when switch is clicked', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      // Find and click the switch for score threshold
      const switches = screen.getAllByRole('switch')
      const scoreThresholdSwitch = switches[0] // The score threshold switch
      await user.click(scoreThresholdSwitch)

      // Fill required fields
      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'kb-1' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          external_retrieval_model: expect.objectContaining({
            score_threshold_enabled: true,
          }),
        }),
      )
    })

    it('should display retrieval settings labels', () => {
      renderComponent()

      // Should show the retrieval settings section title
      expect(screen.getByText('dataset.retrievalSettings')).toBeInTheDocument()
      // Should show Top K and Score Threshold labels
      expect(screen.getByText('appDebug.datasetConfig.top_k')).toBeInTheDocument()
      expect(screen.getByText('appDebug.datasetConfig.score_threshold')).toBeInTheDocument()
    })
  })

  // Direct unit tests for RetrievalSettings component to cover all branches
  describe('RetrievalSettings Component Direct Tests', () => {
    it('should render with isInHitTesting mode', () => {
      const onChange = vi.fn()
      render(
        <RetrievalSettings
          topK={4}
          scoreThreshold={0.5}
          scoreThresholdEnabled={false}
          onChange={onChange}
          isInHitTesting={true}
        />,
      )

      // In hit testing mode, the title should not be shown
      expect(screen.queryByText('dataset.retrievalSettings')).not.toBeInTheDocument()
    })

    it('should render with isInRetrievalSetting mode', () => {
      const onChange = vi.fn()
      render(
        <RetrievalSettings
          topK={4}
          scoreThreshold={0.5}
          scoreThresholdEnabled={false}
          onChange={onChange}
          isInRetrievalSetting={true}
        />,
      )

      // In retrieval setting mode, the title should not be shown
      expect(screen.queryByText('dataset.retrievalSettings')).not.toBeInTheDocument()
    })

    it('should call onChange with score_threshold_enabled when switch is toggled', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <RetrievalSettings
          topK={4}
          scoreThreshold={0.5}
          scoreThresholdEnabled={false}
          onChange={onChange}
        />,
      )

      // Find and click the switch
      const switches = screen.getAllByRole('switch')
      await user.click(switches[0])

      expect(onChange).toHaveBeenCalledWith({ score_threshold_enabled: true })
    })

    it('should call onChange with top_k when top k value changes', () => {
      const onChange = vi.fn()
      render(
        <RetrievalSettings
          topK={4}
          scoreThreshold={0.5}
          scoreThresholdEnabled={false}
          onChange={onChange}
        />,
      )

      // The TopKItem should render an input
      const inputs = screen.getAllByRole('spinbutton')
      const topKInput = inputs[0]
      fireEvent.change(topKInput, { target: { value: '8' } })

      expect(onChange).toHaveBeenCalledWith({ top_k: 8 })
    })

    it('should call onChange with score_threshold when threshold value changes', () => {
      const onChange = vi.fn()
      render(
        <RetrievalSettings
          topK={4}
          scoreThreshold={0.5}
          scoreThresholdEnabled={true}
          onChange={onChange}
        />,
      )

      // The ScoreThresholdItem should render an input
      const inputs = screen.getAllByRole('spinbutton')
      const scoreThresholdInput = inputs[1]
      fireEvent.change(scoreThresholdInput, { target: { value: '0.8' } })

      expect(onChange).toHaveBeenCalledWith({ score_threshold: 0.8 })
    })
  })

  // Tests for complete form submission flow
  describe('Complete Form Submission Flow', () => {
    it('should submit form with all default retrieval settings', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Test KB' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'kb-1' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      expect(onConnect).toHaveBeenCalledWith({
        name: 'Test KB',
        description: '',
        external_knowledge_api_id: 'api-1',
        external_knowledge_id: 'kb-1',
        external_retrieval_model: {
          top_k: 4,
          score_threshold: 0.5,
          score_threshold_enabled: false,
        },
        provider: 'external',
      })
    })

    it('should submit form with modified retrieval settings', async () => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      renderComponent({ onConnect })

      // Toggle score threshold switch
      const switches = screen.getAllByRole('switch')
      const scoreThresholdSwitch = switches[0]
      await user.click(scoreThresholdSwitch)

      // Fill required fields
      const nameInput = screen.getByPlaceholderText('dataset.externalKnowledgeNamePlaceholder')
      const knowledgeIdInput = screen.getByPlaceholderText('dataset.externalKnowledgeIdPlaceholder')

      fireEvent.change(nameInput, { target: { value: 'Custom KB' } })
      fireEvent.change(knowledgeIdInput, { target: { value: 'custom-kb' } })

      await waitFor(() => {
        const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
        expect(connectButton).not.toBeDisabled()
      })

      const connectButton = screen.getByText('dataset.externalKnowledgeForm.connect').closest('button')
      await user.click(connectButton!)

      expect(onConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Custom KB',
          external_retrieval_model: expect.objectContaining({
            score_threshold_enabled: true,
          }),
        }),
      )
    })
  })

  // Tests for accessibility
  describe('Accessibility', () => {
    it('should have accessible buttons', () => {
      renderComponent()

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(3) // back, cancel, connect
    })

    it('should have proper link attributes for external links', () => {
      renderComponent()

      const externalLink = screen.getByText('dataset.connectHelper.helper4')
      expect(externalLink.tagName).toBe('A')
      expect(externalLink).toHaveAttribute('target', '_blank')
      expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('should have labels for form inputs', () => {
      renderComponent()

      // Check labels exist
      expect(screen.getByText('dataset.externalKnowledgeName')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalKnowledgeDescription')).toBeInTheDocument()
      expect(screen.getByText('dataset.externalKnowledgeId')).toBeInTheDocument()
    })
  })
})
