import type { NotionPage } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import Toast from '@/app/components/base/toast'
import OnlineDocumentPreview from './online-document-preview'

// Uses global react-i18next mock from web/vitest.setup.ts

// Spy on Toast.notify
const toastNotifySpy = vi.spyOn(Toast, 'notify')

// Mock dataset-detail context - needs mock to control return values
const mockPipelineId = vi.fn()
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (_selector: (s: { dataset: { pipeline_id: string } }) => string) => {
    return mockPipelineId()
  },
}))

// Mock usePreviewOnlineDocument hook - needs mock to control mutation behavior
const mockMutateAsync = vi.fn()
const mockUsePreviewOnlineDocument = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  usePreviewOnlineDocument: () => mockUsePreviewOnlineDocument(),
}))

// Mock data source store - needs mock to control store state
const mockCurrentCredentialId = 'credential-123'
const mockGetState = vi.fn(() => ({
  currentCredentialId: mockCurrentCredentialId,
}))
vi.mock('../data-source/store', () => ({
  useDataSourceStore: () => ({
    getState: mockGetState,
  }),
}))

// Test data factory
const createMockNotionPage = (overrides?: Partial<NotionPage>): NotionPage => ({
  page_id: 'page-123',
  page_name: 'Test Notion Page',
  workspace_id: 'workspace-456',
  type: 'page',
  page_icon: null,
  parent_id: 'parent-789',
  is_bound: true,
  ...overrides,
})

const defaultProps = {
  currentPage: createMockNotionPage(),
  datasourceNodeId: 'datasource-node-123',
  hidePreview: vi.fn(),
}

describe('OnlineDocumentPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPipelineId.mockReturnValue('pipeline-123')
    mockUsePreviewOnlineDocument.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    })
    mockMutateAsync.mockImplementation((params, callbacks) => {
      callbacks.onSuccess({ content: 'Test content' })
      return Promise.resolve({ content: 'Test content' })
    })
  })

  describe('Rendering', () => {
    it('should render the component with page information', () => {
      render(<OnlineDocumentPreview {...defaultProps} />)

      // i18n mock returns key by default
      expect(screen.getByText('datasetPipeline.addDocuments.stepOne.preview')).toBeInTheDocument()
      expect(screen.getByText('Test Notion Page')).toBeInTheDocument()
    })

    it('should display page type', () => {
      const currentPage = createMockNotionPage({ type: 'database' })

      render(<OnlineDocumentPreview {...defaultProps} currentPage={currentPage} />)

      expect(screen.getByText('database')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<OnlineDocumentPreview {...defaultProps} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Data Fetching', () => {
    it('should call mutateAsync with correct parameters on mount', async () => {
      const currentPage = createMockNotionPage({
        workspace_id: 'ws-123',
        page_id: 'pg-456',
        type: 'page',
      })

      render(
        <OnlineDocumentPreview
          {...defaultProps}
          currentPage={currentPage}
          datasourceNodeId="node-789"
        />,
      )

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          {
            workspaceID: 'ws-123',
            pageID: 'pg-456',
            pageType: 'page',
            pipelineId: 'pipeline-123',
            datasourceNodeId: 'node-789',
            credentialId: mockCurrentCredentialId,
          },
          expect.objectContaining({
            onSuccess: expect.any(Function),
            onError: expect.any(Function),
          }),
        )
      })
    })

    it('should fetch data again when page_id changes', async () => {
      const currentPage1 = createMockNotionPage({ page_id: 'page-1' })
      const currentPage2 = createMockNotionPage({ page_id: 'page-2' })

      const { rerender } = render(
        <OnlineDocumentPreview {...defaultProps} currentPage={currentPage1} />,
      )

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(1)
      })

      rerender(<OnlineDocumentPreview {...defaultProps} currentPage={currentPage2} />)

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(2)
      })
    })

    it('should handle empty pipelineId', async () => {
      mockPipelineId.mockReturnValue(undefined)

      render(<OnlineDocumentPreview {...defaultProps} />)

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            pipelineId: '',
          }),
          expect.anything(),
        )
      })
    })
  })

  describe('Loading State', () => {
    it('should render loading component when isPending is true', () => {
      mockUsePreviewOnlineDocument.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      // Loading component renders skeleton
      expect(document.querySelector('.overflow-hidden')).toBeInTheDocument()
    })

    it('should not render markdown content when loading', () => {
      mockUsePreviewOnlineDocument.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      // Content area should not be present
      expect(screen.queryByText('Test content')).not.toBeInTheDocument()
    })
  })

  describe('Content Display', () => {
    it('should render markdown content when loaded', async () => {
      mockMutateAsync.mockImplementation((params, callbacks) => {
        callbacks.onSuccess({ content: 'Markdown content here' })
        return Promise.resolve({ content: 'Markdown content here' })
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      await waitFor(() => {
        // Markdown component renders the content
        const contentArea = document.querySelector('.overflow-hidden.px-6.py-5')
        expect(contentArea).toBeInTheDocument()
      })
    })

    it('should display character count', async () => {
      mockMutateAsync.mockImplementation((params, callbacks) => {
        callbacks.onSuccess({ content: 'Hello' }) // 5 characters
        return Promise.resolve({ content: 'Hello' })
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      await waitFor(() => {
        // Real formatNumberAbbreviated returns "5" for numbers < 1000
        expect(screen.getByText(/5/)).toBeInTheDocument()
      })
    })

    it('should format large character counts', async () => {
      const longContent = 'a'.repeat(2500)
      mockMutateAsync.mockImplementation((params, callbacks) => {
        callbacks.onSuccess({ content: longContent })
        return Promise.resolve({ content: longContent })
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      await waitFor(() => {
        // Real formatNumberAbbreviated uses lowercase 'k': "2.5k"
        expect(screen.getByText(/2\.5k/)).toBeInTheDocument()
      })
    })

    it('should show character count based on fetched content', async () => {
      // When content is set via onSuccess, character count is displayed
      mockMutateAsync.mockImplementation((params, callbacks) => {
        callbacks.onSuccess({ content: 'Test content' }) // 12 characters
        return Promise.resolve({ content: 'Test content' })
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText(/12/)).toBeInTheDocument()
      })
    })
  })

  describe('Error Handling', () => {
    it('should show toast notification on error', async () => {
      const errorMessage = 'Failed to fetch document'
      mockMutateAsync.mockImplementation((params, callbacks) => {
        callbacks.onError(new Error(errorMessage))
        // Return a resolved promise to avoid unhandled rejection
        return Promise.resolve()
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          type: 'error',
          message: errorMessage,
        })
      })
    })

    it('should handle network errors', async () => {
      const networkError = new Error('Network Error')
      mockMutateAsync.mockImplementation((params, callbacks) => {
        callbacks.onError(networkError)
        // Return a resolved promise to avoid unhandled rejection
        return Promise.resolve()
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      await waitFor(() => {
        expect(toastNotifySpy).toHaveBeenCalledWith({
          type: 'error',
          message: 'Network Error',
        })
      })
    })
  })

  describe('User Interactions', () => {
    it('should call hidePreview when close button is clicked', () => {
      const hidePreview = vi.fn()

      render(<OnlineDocumentPreview {...defaultProps} hidePreview={hidePreview} />)

      // Find the close button in the header area (not toast buttons)
      const headerArea = document.querySelector('.flex.gap-x-2.border-b')
      const closeButton = headerArea?.querySelector('button')
      expect(closeButton).toBeInTheDocument()
      fireEvent.click(closeButton!)

      expect(hidePreview).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined page_name', () => {
      const currentPage = createMockNotionPage({ page_name: '' })

      render(<OnlineDocumentPreview {...defaultProps} currentPage={currentPage} />)

      // Find the close button in the header area
      const headerArea = document.querySelector('.flex.gap-x-2.border-b')
      const closeButton = headerArea?.querySelector('button')
      expect(closeButton).toBeInTheDocument()
    })

    it('should handle different page types', () => {
      const currentPage = createMockNotionPage({ type: 'database' })

      render(<OnlineDocumentPreview {...defaultProps} currentPage={currentPage} />)

      expect(screen.getByText('database')).toBeInTheDocument()
    })

    it('should use credentialId from store', async () => {
      mockGetState.mockReturnValue({
        currentCredentialId: 'custom-credential',
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            credentialId: 'custom-credential',
          }),
          expect.anything(),
        )
      })
    })

    it('should not render markdown content when content is empty and not pending', async () => {
      mockMutateAsync.mockImplementation((params, callbacks) => {
        callbacks.onSuccess({ content: '' })
        return Promise.resolve({ content: '' })
      })
      mockUsePreviewOnlineDocument.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      })

      render(<OnlineDocumentPreview {...defaultProps} />)

      // Content is empty, markdown area should still render but be empty
      await waitFor(() => {
        expect(screen.queryByText('Test content')).not.toBeInTheDocument()
      })
    })
  })
})
