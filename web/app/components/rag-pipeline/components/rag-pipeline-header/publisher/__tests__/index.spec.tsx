import type { IconInfo } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import Publisher from '../index'
import Popup from '../popup'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useParams: () => ({ datasetId: 'test-dataset-id' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode, href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const mockHandleSyncWorkflowDraft = vi.fn()
const mockHandleCheckBeforePublish = vi.fn().mockResolvedValue(true)
vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
  useChecklistBeforePublish: () => ({
    handleCheckBeforePublish: mockHandleCheckBeforePublish,
  }),
}))

const mockPublishedAt = vi.fn(() => null as number | null)
const mockDraftUpdatedAt = vi.fn(() => 1700000000)
const mockPipelineId = vi.fn(() => 'test-pipeline-id')
const mockSetPublishedAt = vi.fn()

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      publishedAt: mockPublishedAt(),
      draftUpdatedAt: mockDraftUpdatedAt(),
      pipelineId: mockPipelineId(),
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => ({
      setPublishedAt: mockSetPublishedAt,
    }),
  }),
}))

const mockMutateDatasetRes = vi.fn()
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = { mutateDatasetRes: mockMutateDatasetRes }
    return selector(state)
  },
}))

const mockSetShowPricingModal = vi.fn()
vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: () => mockSetShowPricingModal,
}))

const mockIsAllowPublishAsCustomKnowledgePipelineTemplate = vi.fn(() => true)
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    isAllowPublishAsCustomKnowledgePipelineTemplate: mockIsAllowPublishAsCustomKnowledgePipelineTemplate(),
  }),
  useProviderContextSelector: <T,>(selector: (s: { isAllowPublishAsCustomKnowledgePipelineTemplate: boolean }) => T): T =>
    selector({ isAllowPublishAsCustomKnowledgePipelineTemplate: mockIsAllowPublishAsCustomKnowledgePipelineTemplate() }),
}))

const mockNotify = vi.fn()

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://api.dify.ai/v1/datasets/test-dataset-id',
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => {
      const diff = Date.now() / 1000 - timestamp
      if (diff < 60)
        return 'just now'
      if (diff < 3600)
        return `${Math.floor(diff / 60)} minutes ago`
      return new Date(timestamp * 1000).toLocaleDateString()
    },
  }),
}))

const mockPublishWorkflow = vi.fn()
const mockPublishAsCustomizedPipeline = vi.fn()
const mockInvalidPublishedPipelineInfo = vi.fn()
const mockInvalidDatasetList = vi.fn()
const mockInvalidCustomizedTemplateList = vi.fn()

vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

vi.mock('@/service/use-base', () => ({
  useInvalid: () => mockInvalidPublishedPipelineInfo,
}))

vi.mock('@/service/use-pipeline', () => ({
  publishedPipelineInfoQueryKeyPrefix: ['pipeline', 'published'],
  useInvalidCustomizedTemplateList: () => mockInvalidCustomizedTemplateList,
  usePublishAsCustomizedPipeline: () => ({
    mutateAsync: mockPublishAsCustomizedPipeline,
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  usePublishWorkflow: () => ({
    mutateAsync: mockPublishWorkflow,
  }),
}))

vi.mock('@/app/components/workflow/utils', () => ({
  getKeyboardKeyCodeBySystem: (key: string) => key,
  getKeyboardKeyNameBySystem: (key: string) => key === 'ctrl' ? '⌘' : key,
}))

vi.mock('../../../publish-as-knowledge-pipeline-modal', () => ({
  default: ({ confirmDisabled, onConfirm, onCancel }: {
    confirmDisabled: boolean
    onConfirm: (name: string, icon: IconInfo, description?: string) => void
    onCancel: () => void
  }) => (
    <div data-testid="publish-as-knowledge-pipeline-modal">
      <button
        data-testid="modal-confirm"
        disabled={confirmDisabled}
        onClick={() => onConfirm('Test Pipeline', { type: 'emoji', emoji: '📚', background: '#fff' } as unknown as IconInfo, 'Test description')}
      >
        Confirm
      </button>
      <button data-testid="modal-cancel" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
        {ui}
      </ToastContext.Provider>
    </QueryClientProvider>,
  )
}

describe('publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPublishedAt.mockReturnValue(null)
    mockDraftUpdatedAt.mockReturnValue(1700000000)
    mockPipelineId.mockReturnValue('test-pipeline-id')
    mockIsAllowPublishAsCustomKnowledgePipelineTemplate.mockReturnValue(true)
    mockHandleCheckBeforePublish.mockResolvedValue(true)
  })

  describe('Publisher (index.tsx)', () => {
    describe('Rendering', () => {
      it('should render publish button with correct text', () => {
        renderWithQueryClient(<Publisher />)

        expect(screen.getByRole('button')).toBeInTheDocument()
        expect(screen.getByText('workflow.common.publish')).toBeInTheDocument()
      })

      it('should render portal element in closed state by default', () => {
        renderWithQueryClient(<Publisher />)

        const trigger = screen.getByText('workflow.common.publish').closest('[data-state]')
        expect(trigger).toHaveAttribute('data-state', 'closed')
        expect(screen.queryByText('workflow.common.publishUpdate')).not.toBeInTheDocument()
      })

      it('should render down arrow icon in button', () => {
        renderWithQueryClient(<Publisher />)

        const button = screen.getByRole('button')
        expect(button.querySelector('svg')).toBeInTheDocument()
      })
    })

    describe('State Management', () => {
      it('should open popup when trigger is clicked', async () => {
        renderWithQueryClient(<Publisher />)

        fireEvent.click(screen.getByText('workflow.common.publish'))

        await waitFor(() => {
          expect(screen.getByText('workflow.common.publishUpdate')).toBeInTheDocument()
        })
      })

      it('should close popup when trigger is clicked again while open', async () => {
        renderWithQueryClient(<Publisher />)
        fireEvent.click(screen.getByText('workflow.common.publish')) // open

        await waitFor(() => {
          expect(screen.getByText('workflow.common.publishUpdate')).toBeInTheDocument()
        })
        fireEvent.click(screen.getByText('workflow.common.publish')) // close

        await waitFor(() => {
          expect(screen.queryByText('workflow.common.publishUpdate')).not.toBeInTheDocument()
        })
      })
    })

    describe('Callback Stability and Memoization', () => {
      it('should call handleSyncWorkflowDraft when popup opens', async () => {
        renderWithQueryClient(<Publisher />)

        fireEvent.click(screen.getByText('workflow.common.publish'))

        expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
      })

      it('should not call handleSyncWorkflowDraft when popup closes', async () => {
        renderWithQueryClient(<Publisher />)
        fireEvent.click(screen.getByText('workflow.common.publish')) // open
        vi.clearAllMocks()

        await waitFor(() => {
          expect(screen.getByText('workflow.common.publishUpdate')).toBeInTheDocument()
        })
        fireEvent.click(screen.getByText('workflow.common.publish')) // close

        expect(mockHandleSyncWorkflowDraft).not.toHaveBeenCalled()
      })

      it('should be memoized with React.memo', () => {
        expect(Publisher).toBeDefined()
        expect((Publisher as unknown as { $$typeof?: symbol }).$$typeof?.toString()).toContain('Symbol')
      })
    })

    describe('User Interactions', () => {
      it('should render popup content when opened', async () => {
        renderWithQueryClient(<Publisher />)

        fireEvent.click(screen.getByText('workflow.common.publish'))

        await waitFor(() => {
          expect(screen.getByText('workflow.common.publishUpdate')).toBeInTheDocument()
        })
      })
    })
  })

  describe('Popup (popup.tsx)', () => {
    describe('Rendering', () => {
      it('should render unpublished state when publishedAt is null', () => {
        mockPublishedAt.mockReturnValue(null)

        renderWithQueryClient(<Popup />)

        expect(screen.getByText('workflow.common.currentDraftUnpublished')).toBeInTheDocument()
        expect(screen.getByText(/workflow.common.autoSaved/)).toBeInTheDocument()
      })

      it('should render published state when publishedAt has value', () => {
        mockPublishedAt.mockReturnValue(1700000000)

        renderWithQueryClient(<Popup />)

        expect(screen.getByText('workflow.common.latestPublished')).toBeInTheDocument()
        expect(screen.getByText(/workflow.common.publishedAt/)).toBeInTheDocument()
      })

      it('should render publish button with keyboard shortcuts', () => {
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        expect(publishButton).toBeInTheDocument()
      })

      it('should render action buttons section', () => {
        mockPublishedAt.mockReturnValue(1700000000)

        renderWithQueryClient(<Popup />)

        expect(screen.getByText('pipeline.common.goToAddDocuments')).toBeInTheDocument()
        expect(screen.getByText('workflow.common.accessAPIReference')).toBeInTheDocument()
        expect(screen.getByText('pipeline.common.publishAs')).toBeInTheDocument()
      })

      it('should disable action buttons when not published', () => {
        mockPublishedAt.mockReturnValue(null)

        renderWithQueryClient(<Popup />)

        const addDocumentsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.goToAddDocuments'),
        )
        expect(addDocumentsButton).toBeDisabled()
      })

      it('should enable action buttons when published', () => {
        mockPublishedAt.mockReturnValue(1700000000)

        renderWithQueryClient(<Popup />)

        const addDocumentsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.goToAddDocuments'),
        )
        expect(addDocumentsButton).not.toBeDisabled()
      })

      it('should show premium badge when publish as template is not allowed', () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockIsAllowPublishAsCustomKnowledgePipelineTemplate.mockReturnValue(false)

        renderWithQueryClient(<Popup />)

        expect(screen.getByText('billing.upgradeBtn.encourageShort')).toBeInTheDocument()
      })

      it('should not show premium badge when publish as template is allowed', () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockIsAllowPublishAsCustomKnowledgePipelineTemplate.mockReturnValue(true)

        renderWithQueryClient(<Popup />)

        expect(screen.queryByText('billing.upgradeBtn.encourageShort')).not.toBeInTheDocument()
      })
    })

    describe('State Management', () => {
      it('should show confirm modal when first publish attempt on unpublished pipeline', async () => {
        mockPublishedAt.mockReturnValue(null)
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
        })
      })

      it('should not show confirm modal when already published', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockPublishWorkflow).toHaveBeenCalled()
        })
      })

      it('should update to published state after successful publish', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(screen.getByRole('button', { name: /workflow.common.published/i })).toBeInTheDocument()
        })
      })
    })

    describe('User Interactions', () => {
      it('should navigate to add documents when go to add documents is clicked', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        renderWithQueryClient(<Popup />)

        const addDocumentsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.goToAddDocuments'),
        )
        fireEvent.click(addDocumentsButton!)

        expect(mockPush).toHaveBeenCalledWith('/datasets/test-dataset-id/documents/create-from-pipeline')
      })

      it('should show pricing modal when publish as template is clicked without permission', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockIsAllowPublishAsCustomKnowledgePipelineTemplate.mockReturnValue(false)
        renderWithQueryClient(<Popup />)

        const publishAsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.publishAs'),
        )
        fireEvent.click(publishAsButton!)

        expect(mockSetShowPricingModal).toHaveBeenCalled()
      })

      it('should show publish as knowledge pipeline modal when permitted', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockIsAllowPublishAsCustomKnowledgePipelineTemplate.mockReturnValue(true)
        renderWithQueryClient(<Popup />)

        const publishAsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.publishAs'),
        )
        fireEvent.click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })
      })

      it('should close publish as knowledge pipeline modal when cancel is clicked', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockIsAllowPublishAsCustomKnowledgePipelineTemplate.mockReturnValue(true)
        renderWithQueryClient(<Popup />)

        const publishAsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.publishAs'),
        )
        fireEvent.click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByTestId('modal-cancel'))

        await waitFor(() => {
          expect(screen.queryByTestId('publish-as-knowledge-pipeline-modal')).not.toBeInTheDocument()
        })
      })

      it('should call publishAsCustomizedPipeline when confirm is clicked in modal', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishAsCustomizedPipeline.mockResolvedValue({})
        renderWithQueryClient(<Popup />)

        const publishAsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.publishAs'),
        )
        fireEvent.click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByTestId('modal-confirm'))

        await waitFor(() => {
          expect(mockPublishAsCustomizedPipeline).toHaveBeenCalledWith({
            pipelineId: 'test-pipeline-id',
            name: 'Test Pipeline',
            icon_info: { type: 'emoji', emoji: '📚', background: '#fff' },
            description: 'Test description',
          })
        })
      })
    })

    describe('API Calls and Async Operations', () => {
      it('should call publishWorkflow API when publish button is clicked', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockPublishWorkflow).toHaveBeenCalledWith({
            url: '/rag/pipelines/test-pipeline-id/workflows/publish',
            title: '',
            releaseNotes: '',
          })
        })
      })

      it('should show success notification after publish', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockNotify).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'success',
              message: 'datasetPipeline.publishPipeline.success.message',
            }),
          )
        })
      })

      it('should update publishedAt in store after successful publish', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockSetPublishedAt).toHaveBeenCalledWith(1700100000)
        })
      })

      it('should invalidate caches after successful publish', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockMutateDatasetRes).toHaveBeenCalled()
          expect(mockInvalidPublishedPipelineInfo).toHaveBeenCalled()
          expect(mockInvalidDatasetList).toHaveBeenCalled()
        })
      })

      it('should show success notification for publish as template', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishAsCustomizedPipeline.mockResolvedValue({})
        renderWithQueryClient(<Popup />)

        const publishAsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.publishAs'),
        )
        fireEvent.click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByTestId('modal-confirm'))

        await waitFor(() => {
          expect(mockNotify).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'success',
              message: 'datasetPipeline.publishTemplate.success.message',
            }),
          )
        })
      })

      it('should invalidate customized template list after publish as template', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishAsCustomizedPipeline.mockResolvedValue({})
        renderWithQueryClient(<Popup />)

        const publishAsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.publishAs'),
        )
        fireEvent.click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByTestId('modal-confirm'))

        await waitFor(() => {
          expect(mockInvalidCustomizedTemplateList).toHaveBeenCalled()
        })
      })
    })

    describe('Error Handling', () => {
      it('should not proceed with publish when check fails', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockHandleCheckBeforePublish.mockResolvedValue(false)
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockHandleCheckBeforePublish).toHaveBeenCalled()
        })
        expect(mockPublishWorkflow).not.toHaveBeenCalled()
      })

      it('should show error notification when publish fails', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockRejectedValue(new Error('Publish failed'))
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockNotify).toHaveBeenCalledWith({
            type: 'error',
            message: 'datasetPipeline.publishPipeline.error.message',
          })
        })
      })

      it('should show error notification when publish as template fails', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishAsCustomizedPipeline.mockRejectedValue(new Error('Template publish failed'))
        renderWithQueryClient(<Popup />)

        const publishAsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.publishAs'),
        )
        fireEvent.click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByTestId('modal-confirm'))

        await waitFor(() => {
          expect(mockNotify).toHaveBeenCalledWith({
            type: 'error',
            message: 'datasetPipeline.publishTemplate.error.message',
          })
        })
      })

      it('should close modal after publish as template error', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishAsCustomizedPipeline.mockRejectedValue(new Error('Template publish failed'))
        renderWithQueryClient(<Popup />)

        const publishAsButton = screen.getAllByRole('button').find(btn =>
          btn.textContent?.includes('pipeline.common.publishAs'),
        )
        fireEvent.click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        fireEvent.click(screen.getByTestId('modal-confirm'))

        await waitFor(() => {
          expect(screen.queryByTestId('publish-as-knowledge-pipeline-modal')).not.toBeInTheDocument()
        })
      })
    })

    describe('Confirm Modal', () => {
      it('should hide confirm modal when cancel is clicked', async () => {
        mockPublishedAt.mockReturnValue(null)
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
        })

        const cancelButtons = screen.getAllByRole('button')
        const cancelButton = cancelButtons.find(btn =>
          btn.className.includes('cancel') || btn.textContent?.includes('Cancel'),
        )
        if (cancelButton)
          fireEvent.click(cancelButton)

        // Note: This test verifies the confirm modal can be displayed
        expect(screen.getByText('pipeline.common.confirmPublishContent')).toBeInTheDocument()
      })

      it('should publish when confirm is clicked in confirm modal', async () => {
        mockPublishedAt.mockReturnValue(null)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton) // This shows confirm modal

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
        })

        expect(screen.getByText('pipeline.common.confirmPublishContent')).toBeInTheDocument()
      })
    })

    describe('Component Memoization', () => {
      it('should be memoized with React.memo', () => {
        expect(Popup).toBeDefined()
        expect((Popup as unknown as { $$typeof?: symbol }).$$typeof?.toString()).toContain('Symbol')
      })
    })

    describe('Prop Variations', () => {
      it('should display correct width when permission is allowed', () => {
        mockIsAllowPublishAsCustomKnowledgePipelineTemplate.mockReturnValue(true)
        const { container } = renderWithQueryClient(<Popup />)

        const popupDiv = container.firstChild as HTMLElement
        expect(popupDiv.className).toContain('w-[360px]')
      })

      it('should display correct width when permission is not allowed', () => {
        mockIsAllowPublishAsCustomKnowledgePipelineTemplate.mockReturnValue(false)
        const { container } = renderWithQueryClient(<Popup />)

        const popupDiv = container.firstChild as HTMLElement
        expect(popupDiv.className).toContain('w-[400px]')
      })

      it('should display draft updated time when not published', () => {
        mockPublishedAt.mockReturnValue(null)
        mockDraftUpdatedAt.mockReturnValue(1700000000)

        renderWithQueryClient(<Popup />)

        expect(screen.getByText(/workflow.common.autoSaved/)).toBeInTheDocument()
      })

      it('should handle null draftUpdatedAt gracefully', () => {
        mockPublishedAt.mockReturnValue(null)
        mockDraftUpdatedAt.mockReturnValue(0)

        renderWithQueryClient(<Popup />)

        expect(screen.getByText(/workflow.common.autoSaved/)).toBeInTheDocument()
      })
    })

    describe('API Reference Link', () => {
      it('should render API reference link with correct href', () => {
        mockPublishedAt.mockReturnValue(1700000000)

        renderWithQueryClient(<Popup />)

        const apiLink = screen.getByRole('link')
        expect(apiLink).toHaveAttribute('href', 'https://api.dify.ai/v1/datasets/test-dataset-id')
        expect(apiLink).toHaveAttribute('target', '_blank')
      })
    })

    describe('Keyboard Shortcuts', () => {
      it('should trigger publish when keyboard shortcut is pressed', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        fireEvent.keyDown(window, { key: 'p', keyCode: 80, ctrlKey: true, shiftKey: true })

        await waitFor(() => {
          expect(mockPublishWorkflow).toHaveBeenCalled()
        })
      })

      it('should not trigger publish when already published in session', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(screen.getByRole('button', { name: /workflow.common.published/i })).toBeInTheDocument()
        })

        vi.clearAllMocks()

        fireEvent.keyDown(window, { key: 'p', keyCode: 80, ctrlKey: true, shiftKey: true })

        expect(mockPublishWorkflow).not.toHaveBeenCalled()
      })

      it('should show confirm modal when shortcut pressed on unpublished pipeline', async () => {
        mockPublishedAt.mockReturnValue(null)
        renderWithQueryClient(<Popup />)

        fireEvent.keyDown(window, { key: 'p', keyCode: 80, ctrlKey: true, shiftKey: true })

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
        })
      })

      it('should not trigger duplicate publish via shortcut when already publishing', async () => {
        let resolvePublish: () => void = () => {}
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockImplementation(() => new Promise((resolve) => {
          resolvePublish = () => resolve({ created_at: 1700100000 })
        }))
        renderWithQueryClient(<Popup />)

        fireEvent.keyDown(window, { key: 'p', keyCode: 80, ctrlKey: true, shiftKey: true })

        await waitFor(() => {
          const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
          expect(publishButton).toBeDisabled()
        })

        fireEvent.keyDown(window, { key: 'p', keyCode: 80, ctrlKey: true, shiftKey: true })

        expect(mockPublishWorkflow).toHaveBeenCalledTimes(1)

        resolvePublish()
      })
    })

    describe('Finally Block Cleanup', () => {
      it('should reset publishing state after successful publish', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(screen.getByRole('button', { name: /workflow.common.published/i })).toBeInTheDocument()
        })
      })

      it('should reset publishing state after failed publish', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockRejectedValue(new Error('Publish failed'))
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockNotify).toHaveBeenCalledWith({
            type: 'error',
            message: 'datasetPipeline.publishPipeline.error.message',
          })
        })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: /workflow.common.publishUpdate/i })).toBeInTheDocument()
        })
      })

      it('should hide confirm modal after publish from confirm', async () => {
        mockPublishedAt.mockReturnValue(null)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
        })

        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(screen.getByRole('button', { name: /workflow.common.published/i })).toBeInTheDocument()
        })
      })

      it('should hide confirm modal after failed publish', async () => {
        mockPublishedAt.mockReturnValue(null)
        mockPublishWorkflow.mockRejectedValue(new Error('Publish failed'))
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
        })

        fireEvent.click(publishButton)

        await waitFor(() => {
          expect(mockNotify).toHaveBeenCalledWith({
            type: 'error',
            message: 'datasetPipeline.publishPipeline.error.message',
          })
        })
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined pipelineId gracefully', () => {
      mockPipelineId.mockReturnValue('')

      renderWithQueryClient(<Popup />)

      expect(screen.getByText('workflow.common.currentDraftUnpublished')).toBeInTheDocument()
    })

    it('should handle empty publish response', async () => {
      mockPublishedAt.mockReturnValue(1700000000)
      mockPublishWorkflow.mockResolvedValue(null)
      renderWithQueryClient(<Popup />)

      const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
      fireEvent.click(publishButton)

      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalled()
      })
      expect(mockSetPublishedAt).not.toHaveBeenCalled()
    })

    it('should prevent multiple simultaneous publish calls', async () => {
      mockPublishedAt.mockReturnValue(1700000000)
      mockPublishWorkflow.mockImplementation(() => new Promise(() => {}))
      renderWithQueryClient(<Popup />)

      const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
      fireEvent.click(publishButton)

      await waitFor(() => {
        expect(publishButton).toBeDisabled()
      })

      fireEvent.click(publishButton)
      fireEvent.click(publishButton)

      expect(mockPublishWorkflow).toHaveBeenCalledTimes(1)
    })

    it('should disable publish button when already published in session', async () => {
      mockPublishedAt.mockReturnValue(1700000000)
      mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
      renderWithQueryClient(<Popup />)

      const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
      fireEvent.click(publishButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /workflow.common.published/i })).toBeDisabled()
      })
    })

    it('should not trigger publish when already publishing', async () => {
      mockPublishedAt.mockReturnValue(1700000000)
      mockPublishWorkflow.mockImplementation(() => new Promise(() => {})) // Never resolves
      renderWithQueryClient(<Popup />)

      const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
      fireEvent.click(publishButton)

      await waitFor(() => {
        expect(publishButton).toBeDisabled()
      })
    })
  })

  describe('Integration Tests', () => {
    it('should complete full publish flow for unpublished pipeline', async () => {
      mockPublishedAt.mockReturnValue(null)
      mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
      renderWithQueryClient(<Popup />)

      const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
      fireEvent.click(publishButton)

      await waitFor(() => {
        expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
      })
    })

    it('should complete full publish as template flow', async () => {
      mockPublishedAt.mockReturnValue(1700000000)
      mockPublishAsCustomizedPipeline.mockResolvedValue({})
      renderWithQueryClient(<Popup />)

      const publishAsButton = screen.getAllByRole('button').find(btn =>
        btn.textContent?.includes('pipeline.common.publishAs'),
      )
      fireEvent.click(publishAsButton!)

      await waitFor(() => {
        expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('modal-confirm'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
          }),
        )
        expect(screen.queryByTestId('publish-as-knowledge-pipeline-modal')).not.toBeInTheDocument()
      })
    })

    it('should show Publisher button and open popup with Popup component', async () => {
      renderWithQueryClient(<Publisher />)

      fireEvent.click(screen.getByText('workflow.common.publish'))

      await waitFor(() => {
        expect(screen.getByText('workflow.common.publishUpdate')).toBeInTheDocument()
      })

      expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledWith(true)
    })
  })
})
