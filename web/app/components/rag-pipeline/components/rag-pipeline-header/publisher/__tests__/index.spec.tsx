import type { IconInfo } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderEditor as renderWithoutPricing } from '@/app/components/workflow/editor-resource/__tests__/render'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedFeatures, seedSystemFeatures } from '@/test/console/query-data'
import Publisher from '../index'
import { Popup } from '../popup'

const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
const datasetListKey = consoleQuery.datasets.get.key()

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/features/system-features/state', async () => {
  const { atom } = await import('jotai')
  return {
    deploymentEditionAtom: atom('CLOUD'),
  }
})

vi.mock('@/next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

const mockHandleSyncWorkflowDraft = vi.fn()
const mockHandleCheckBeforePublish = vi.fn().mockResolvedValue(true)
vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-checklist', () => ({
  useChecklistBeforePublish: () => ({
    handleCheckBeforePublish: mockHandleCheckBeforePublish,
  }),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (
    selector: (state: { accessControl: { canReleaseAndVersion: boolean } }) => unknown,
  ) =>
    selector({
      accessControl: { canReleaseAndVersion: true },
    }),
}))

const mockPublishedAt = vi.fn(() => null as number | null)
const mockDraftUpdatedAt = vi.fn(() => 1700000000)
const mockPipelineId = vi.fn(() => 'test-pipeline-id')
const mockSetPublishedAt = vi.fn()
let mockDatasetPermissionKeys = ['dataset.acl.use']
let mockDatasetMaintainer: string | undefined
let mockCurrentUserId = 'user-1'
let mockIsLoadingWorkspacePermissionKeys = false
let mockWorkspacePermissionKeys: string[] = []

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
    const state = {
      dataset: {
        permission_keys: mockDatasetPermissionKeys,
        maintainer: mockDatasetMaintainer,
      },
      mutateDatasetRes: mockMutateDatasetRes,
    }
    return selector(state)
  },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: {
      id: mockCurrentUserId,
    },
    isLoadingWorkspacePermissionKeys: mockIsLoadingWorkspacePermissionKeys,
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

let publishEnabled = true

const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: Object.assign(toastMocks.call, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'success', message, ...options }),
    ),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'error', message, ...options }),
    ),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'warning', message, ...options }),
    ),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'info', message, ...options }),
    ),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://api.dify.ai/v1/datasets/test-dataset-id',
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => {
      const diff = Date.now() / 1000 - timestamp
      if (diff < 60) return 'just now'
      if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
      return new Date(timestamp * 1000).toLocaleDateString()
    },
  }),
}))

const mockPublishWorkflow = vi.fn()
const mockPublishAsCustomizedPipeline = vi.fn()

const expectInvalidated = (...path: string[]) =>
  expect(QueryClient.prototype.invalidateQueries).toHaveBeenCalledWith({
    queryKey: expect.arrayContaining([['console', ...path]]),
  })

vi.mock('../../../publish-as-knowledge-pipeline-modal', () => ({
  default: ({
    confirmDisabled,
    onConfirm,
    onCancel,
  }: {
    confirmDisabled: boolean
    onConfirm: (name: string, icon: IconInfo, description?: string) => void
    onCancel: () => void
  }) => (
    <div data-testid="publish-as-knowledge-pipeline-modal">
      <button
        data-testid="modal-confirm"
        disabled={confirmDisabled}
        onClick={() =>
          onConfirm(
            'Test Pipeline',
            { icon_type: 'emoji', icon: '📚', icon_background: '#fff' },
            'Test description',
          )
        }
      >
        Confirm
      </button>
      <button data-testid="modal-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}))

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  })

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  seedSystemFeatures(queryClient, { deployment_edition: 'CLOUD' })
  seedFeatures(queryClient, { knowledge_pipeline: { publish_enabled: publishEnabled } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(args[0], {
    ...args[1],
    resource: { kind: 'knowledge-pipeline', pipelineId: 'test-pipeline-id' },
  })
}

vi.mock('@/next/navigation', () => ({ useParams: () => ({ datasetId: 'test-dataset-id' }) }))

function publishWithKeyboard() {
  const target = screen.getByRole('button', { name: /workflow.common.publish(?:Update|ed)?/i })
  fireEvent.keyDown(target, { key: 'P', ctrlKey: true, shiftKey: true })
  fireEvent.keyUp(target, { key: 'P', ctrlKey: true, shiftKey: true })
}

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  post: (...args: unknown[]) => mockPublishWorkflow(...args),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.byPipelineId.customized.publish.post': (input) =>
        mockPublishAsCustomizedPipeline(input),
    }),
  }
})

describe('publisher', () => {
  beforeEach(() => {
    vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    vi.clearAllMocks()
    mockPublishedAt.mockReturnValue(null)
    mockDraftUpdatedAt.mockReturnValue(1700000000)
    mockPipelineId.mockReturnValue('test-pipeline-id')
    mockPublishWorkflow.mockReset().mockResolvedValue({ created_at: 1700100000 })
    mockPublishAsCustomizedPipeline.mockReset().mockResolvedValue({})
    publishEnabled = true
    mockHandleCheckBeforePublish.mockResolvedValue(true)
    mockDatasetPermissionKeys = ['dataset.acl.use']
    mockDatasetMaintainer = undefined
    mockCurrentUserId = 'user-1'
    mockIsLoadingWorkspacePermissionKeys = false
    mockWorkspacePermissionKeys = []
  })

  describe('Publisher (index.tsx)', () => {
    describe('State Management', () => {
      it('should close popup when trigger is clicked again while open', async () => {
        renderWithQueryClient(<Publisher />)
        expect(screen.getByRole('button', { name: 'workflow.common.publish' })).toHaveAttribute(
          'aria-expanded',
          'false',
        )
        await userEvent.setup().click(screen.getByText('workflow.common.publish')) // open
        expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledExactlyOnceWith(true)

        await waitFor(() => {
          expect(screen.getByText('workflow.common.publishUpdate')).toBeInTheDocument()
        })
        await userEvent.setup().click(screen.getByText('workflow.common.publish')) // close

        await waitFor(() => {
          expect(screen.queryByText('workflow.common.publishUpdate')).not.toBeInTheDocument()
        })
        expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledOnce()
        expect(screen.getByRole('button', { name: 'workflow.common.publish' })).toHaveAttribute(
          'aria-expanded',
          'false',
        )
      })
    })

    describe('User Interactions', () => {
      it('should close the outer popover before opening publish-as follow-up flow', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        publishEnabled = false
        renderWithQueryClient(<Publisher />)

        await userEvent.setup().click(screen.getByText('workflow.common.publish'))

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.publishAs')).toBeInTheDocument()
        })

        await userEvent.setup().click(screen.getByText('pipeline.common.publishAs'))

        await waitFor(() => {
          expect(screen.queryByText('pipeline.common.publishAs')).not.toBeInTheDocument()
        })
        await waitFor(() =>
          expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
        )
      })
    })
  })

  describe('Popup (popup.tsx)', () => {
    describe('User Interactions', () => {
      it('should close publish as knowledge pipeline modal when cancel is clicked', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        publishEnabled = true
        renderWithQueryClient(<Publisher />)

        await userEvent.setup().click(screen.getByText('workflow.common.publish'))

        const publishAsButton = screen
          .getAllByRole('button')
          .find((btn) => btn.textContent?.includes('pipeline.common.publishAs'))
        await userEvent.setup().click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        await userEvent.setup().click(screen.getByTestId('modal-cancel'))

        await waitFor(() => {
          expect(
            screen.queryByTestId('publish-as-knowledge-pipeline-modal'),
          ).not.toBeInTheDocument()
        })
        expect(mockPublishAsCustomizedPipeline).not.toHaveBeenCalled()
      })

      it('should call publishAsCustomizedPipeline when confirm is clicked in modal', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishAsCustomizedPipeline.mockResolvedValue({})
        renderWithQueryClient(<Publisher />)

        await userEvent.setup().click(screen.getByText('workflow.common.publish'))

        const publishAsButton = screen
          .getAllByRole('button')
          .find((btn) => btn.textContent?.includes('pipeline.common.publishAs'))
        await userEvent.setup().click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        await userEvent.setup().click(screen.getByTestId('modal-confirm'))

        await waitFor(() => {
          expect(mockPublishAsCustomizedPipeline).toHaveBeenCalledWith({
            params: { pipeline_id: 'test-pipeline-id' },
            body: {
              name: 'Test Pipeline',
              icon_info: { icon_type: 'emoji', icon: '📚', icon_background: '#fff' },
              description: 'Test description',
            },
          })
        })
        await waitFor(() =>
          expect(
            screen.queryByTestId('publish-as-knowledge-pipeline-modal'),
          ).not.toBeInTheDocument(),
        )
        expectInvalidated('rag', 'pipeline', 'templates', 'get')
        expect(toastMocks.call).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
            message: 'datasetPipeline.publishTemplate.success.message',
          }),
        )
      })
    })

    describe('API Calls and Async Operations', () => {
      it('should call publishWorkflow API when publish button is clicked', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        await userEvent.setup().click(publishButton)

        await waitFor(() => {
          expect(mockPublishWorkflow).toHaveBeenCalledWith(
            '/rag/pipelines/test-pipeline-id/workflows/publish',
            { body: { marked_name: '', marked_comment: '' } },
          )
        })
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
        )
        expect(mockSetPublishedAt).toHaveBeenCalledWith(1700100000)
        expect(mockMutateDatasetRes).toHaveBeenCalledOnce()
        expectInvalidated('rag', 'pipelines', 'byPipelineId', 'workflows', 'publish', 'get')
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: datasetListKey })
        expect(toastMocks.call).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'success',
            message: 'datasetPipeline.publishPipeline.success.message',
          }),
        )
      })
    })

    describe('Error Handling', () => {
      it('should not proceed with publish when check fails', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockHandleCheckBeforePublish.mockResolvedValue(false)
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        await userEvent.setup().click(publishButton)

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
        await userEvent.setup().click(publishButton)

        await waitFor(() => {
          expect(toastMocks.call).toHaveBeenCalledWith({
            type: 'error',
            message: 'datasetPipeline.publishPipeline.error.message',
          })
        })
        expect(mockSetPublishedAt).not.toHaveBeenCalled()
        expect(invalidateQueries).not.toHaveBeenCalled()
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        await userEvent.setup().click(publishButton)
        await waitFor(() => expect(mockSetPublishedAt).toHaveBeenCalledWith(1700100000))
        expect(mockPublishWorkflow).toHaveBeenCalledTimes(2)
      })

      it('should show error notification when publish as template fails', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishAsCustomizedPipeline.mockRejectedValue(new Error('Template publish failed'))
        renderWithQueryClient(<Publisher />)

        await userEvent.setup().click(screen.getByText('workflow.common.publish'))

        const publishAsButton = screen
          .getAllByRole('button')
          .find((btn) => btn.textContent?.includes('pipeline.common.publishAs'))
        await userEvent.setup().click(publishAsButton!)

        await waitFor(() => {
          expect(screen.getByTestId('publish-as-knowledge-pipeline-modal')).toBeInTheDocument()
        })

        await userEvent.setup().click(screen.getByTestId('modal-confirm'))

        await waitFor(() => {
          expect(toastMocks.call).toHaveBeenCalledWith({
            type: 'error',
            message: 'datasetPipeline.publishTemplate.error.message',
          })
        })
        await waitFor(() =>
          expect(
            screen.queryByTestId('publish-as-knowledge-pipeline-modal'),
          ).not.toBeInTheDocument(),
        )
        expect(invalidateQueries).not.toHaveBeenCalled()
      })
    })

    describe('Confirm Modal', () => {
      it('should publish when confirm is clicked in confirm modal', async () => {
        mockPublishedAt.mockReturnValue(null)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        await userEvent.setup().click(publishButton) // This shows confirm modal

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
        })

        expect(mockPublishWorkflow).not.toHaveBeenCalled()
        await userEvent
          .setup()
          .click(screen.getByRole('button', { name: 'common.operation.confirm' }))

        await waitFor(() => {
          expect(mockPublishWorkflow).toHaveBeenCalled()
        })
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(mockSetPublishedAt).toHaveBeenCalledWith(1700100000)
      })
    })

    describe('Keyboard Shortcuts', () => {
      it('should trigger publish when keyboard shortcut is pressed', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        publishWithKeyboard()

        await waitFor(() => {
          expect(mockPublishWorkflow).toHaveBeenCalled()
        })
      })

      it('should not trigger publish when already published in session', async () => {
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockResolvedValue({ created_at: 1700100000 })
        renderWithQueryClient(<Popup />)

        const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
        await userEvent.setup().click(publishButton)

        await waitFor(() => {
          expect(
            screen.getByRole('button', { name: /workflow.common.published/i }),
          ).toBeInTheDocument()
        })

        vi.clearAllMocks()

        publishWithKeyboard()

        expect(mockPublishWorkflow).not.toHaveBeenCalled()
      })

      it('should show confirm modal when shortcut pressed on unpublished pipeline', async () => {
        mockPublishedAt.mockReturnValue(null)
        renderWithQueryClient(<Popup />)

        publishWithKeyboard()

        await waitFor(() => {
          expect(screen.getByText('pipeline.common.confirmPublish')).toBeInTheDocument()
        })
      })

      it('should not trigger duplicate publish via shortcut when already publishing', async () => {
        let resolvePublish: () => void = () => {}
        mockPublishedAt.mockReturnValue(1700000000)
        mockPublishWorkflow.mockImplementation(
          () =>
            new Promise((resolve) => {
              resolvePublish = () => resolve({ created_at: 1700100000 })
            }),
        )
        renderWithQueryClient(<Popup />)

        publishWithKeyboard()

        await waitFor(() => {
          const publishButton = screen.getByRole('button', {
            name: /workflow.common.publishUpdate/i,
          })
          expect(publishButton).toBeDisabled()
        })

        publishWithKeyboard()

        expect(mockPublishWorkflow).toHaveBeenCalledTimes(1)

        await act(async () => resolvePublish())
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'workflow.common.published' })).toBeDisabled(),
        )
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty publish response', async () => {
      mockPublishedAt.mockReturnValue(1700000000)
      mockPublishWorkflow.mockResolvedValue(null)
      renderWithQueryClient(<Popup />)

      const publishButton = screen.getByRole('button', { name: /workflow.common.publishUpdate/i })
      await userEvent.setup().click(publishButton)

      await waitFor(() => {
        expect(mockPublishWorkflow).toHaveBeenCalled()
      })
      expect(mockSetPublishedAt).not.toHaveBeenCalled()
    })
  })
})
