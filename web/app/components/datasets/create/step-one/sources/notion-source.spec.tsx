import type { NotionSourceProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import NotionSource from './notion-source'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock child components
vi.mock('@/app/components/base/notion-connector', () => ({
  __esModule: true,
  default: ({ onSetting }: { onSetting: () => void }) => (
    <div data-testid="notion-connector">
      <button data-testid="notion-setting" onClick={onSetting}>Connect Notion</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/notion-page-selector', () => ({
  NotionPageSelector: ({
    value,
    onSelect,
    onPreview,
  }: {
    value: string[]
    onSelect: (pages: unknown[]) => void
    onPreview: (page: unknown) => void
  }) => (
    <div data-testid="notion-page-selector">
      <span data-testid="selected-count">{value.length}</span>
      <button data-testid="trigger-select" onClick={() => onSelect([{ page_id: 'page-1' }])}>Select</button>
      <button data-testid="trigger-preview" onClick={() => onPreview({ page_id: 'preview-page' })}>Preview</button>
    </div>
  ),
}))

vi.mock('../common/next-step-button', () => ({
  __esModule: true,
  default: ({ disabled, onClick }: { disabled: boolean, onClick: () => void }) => (
    <button data-testid="next-step-button" disabled={disabled} onClick={onClick}>
      Next Step
    </button>
  ),
}))

vi.mock('../common/vector-space-alert', () => ({
  __esModule: true,
  default: ({ show }: { show: boolean }) => (
    show ? <div data-testid="vector-space-alert">Vector Space Full</div> : null
  ),
}))

// Helper to create mock NotionPage
const createMockNotionPage = (pageId: string = 'page-123') => ({
  page_id: pageId,
  page_name: 'Test Page',
  page_icon: null,
  parent_id: 'parent-1',
  type: 'page',
  is_bound: true,
  workspace_id: 'workspace-1',
})

// Helper to create mock credential list
const createMockCredentialList = () => ([
  {
    credential: {},
    type: CredentialTypeEnum.API_KEY,
    name: 'Test Credential',
    id: 'cred-1',
    is_default: true,
    avatar_url: '',
  },
])

const createDefaultProps = (): NotionSourceProps => ({
  datasetId: undefined,
  notionPages: [],
  notionCredentialId: 'credential-1',
  updateNotionPages: vi.fn(),
  updateNotionCredentialId: vi.fn(),
  onPreview: vi.fn(),
  onSetting: vi.fn(),
  isShowVectorSpaceFull: false,
  onStepChange: vi.fn(),
  isNotionAuthed: true,
  notionCredentialList: createMockCredentialList(),
})

describe('NotionSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests - Not Authed
  // ==========================================
  describe('Rendering - Not Authed', () => {
    it('should render NotionConnector when not authenticated', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        isNotionAuthed: false,
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('notion-connector')).toBeInTheDocument()
      expect(screen.queryByTestId('notion-page-selector')).not.toBeInTheDocument()
    })

    it('should call onSetting when NotionConnector setting is clicked', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        isNotionAuthed: false,
      }
      render(<NotionSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('notion-setting'))

      // Assert
      expect(props.onSetting).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================
  // Rendering Tests - Authed
  // ==========================================
  describe('Rendering - Authed', () => {
    it('should render NotionPageSelector when authenticated', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
      expect(screen.queryByTestId('notion-connector')).not.toBeInTheDocument()
    })

    it('should render NextStepButton when authenticated', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeInTheDocument()
    })

    it('should pass selected page ids to NotionPageSelector', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        notionPages: [createMockNotionPage('page-1'), createMockNotionPage('page-2')],
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('selected-count')).toHaveTextContent('2')
    })
  })

  // ==========================================
  // Next Button Disabled State Tests
  // ==========================================
  describe('Next Button Disabled State', () => {
    it('should disable next button when no pages selected', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })

    it('should disable next button when vector space is full', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        notionPages: [createMockNotionPage()],
        isShowVectorSpaceFull: true,
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })

    it('should enable next button when pages are selected and space available', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        notionPages: [createMockNotionPage()],
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should enable next button with multiple selected pages', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        notionPages: [createMockNotionPage('p1'), createMockNotionPage('p2')],
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should disable next button when both no pages and vector space full', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        notionPages: [],
        isShowVectorSpaceFull: true,
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).toBeDisabled()
    })
  })

  // ==========================================
  // Vector Space Alert Tests
  // ==========================================
  describe('Vector Space Alert', () => {
    it('should not show vector space alert by default', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.queryByTestId('vector-space-alert')).not.toBeInTheDocument()
    })

    it('should show vector space alert when isShowVectorSpaceFull is true', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        isShowVectorSpaceFull: true,
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('vector-space-alert')).toBeInTheDocument()
    })
  })

  // ==========================================
  // Callback Tests
  // ==========================================
  describe('Callbacks', () => {
    it('should call onStepChange when next button is clicked', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        notionPages: [createMockNotionPage()],
      }
      render(<NotionSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('next-step-button'))

      // Assert
      expect(props.onStepChange).toHaveBeenCalledTimes(1)
    })

    it('should call updateNotionPages when pages are selected', () => {
      // Arrange
      const props = createDefaultProps()
      render(<NotionSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-select'))

      // Assert
      expect(props.updateNotionPages).toHaveBeenCalledWith([{ page_id: 'page-1' }])
    })

    it('should call onPreview when page preview is triggered', () => {
      // Arrange
      const props = createDefaultProps()
      render(<NotionSource {...props} />)

      // Act
      fireEvent.click(screen.getByTestId('trigger-preview'))

      // Assert
      expect(props.onPreview).toHaveBeenCalledWith({ page_id: 'preview-page' })
    })
  })

  // ==========================================
  // Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle empty credential list', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        notionCredentialList: [],
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
    })

    it('should handle undefined datasetId', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        datasetId: undefined,
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
    })

    it('should handle with datasetId provided', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        datasetId: 'dataset-123',
      }

      // Act
      render(<NotionSource {...props} />)

      // Assert
      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
    })
  })

  // ==========================================
  // State Update Tests
  // ==========================================
  describe('State Updates', () => {
    it('should update button state when notionPages changes', () => {
      // Arrange
      const props = createDefaultProps()
      const { rerender } = render(<NotionSource {...props} />)

      // Assert initial state
      expect(screen.getByTestId('next-step-button')).toBeDisabled()

      // Act - add pages
      rerender(<NotionSource {...props} notionPages={[createMockNotionPage()]} />)

      // Assert
      expect(screen.getByTestId('next-step-button')).not.toBeDisabled()
    })

    it('should switch from connector to selector when auth changes', () => {
      // Arrange
      const props = {
        ...createDefaultProps(),
        isNotionAuthed: false,
      }
      const { rerender } = render(<NotionSource {...props} />)

      // Assert initial state
      expect(screen.getByTestId('notion-connector')).toBeInTheDocument()

      // Act - authenticate
      rerender(<NotionSource {...props} isNotionAuthed={true} />)

      // Assert
      expect(screen.queryByTestId('notion-connector')).not.toBeInTheDocument()
      expect(screen.getByTestId('notion-page-selector')).toBeInTheDocument()
    })
  })
})
