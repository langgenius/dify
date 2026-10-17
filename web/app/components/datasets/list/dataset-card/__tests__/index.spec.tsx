import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetCard from '../index'

// Mock external hooks only
vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (timestamp: number) => {
      const date = new Date(timestamp)
      return `${date.toLocaleDateString()}`
    },
  }),
}))

const mockPush = vi.fn()
const mockOpenAccessConfig = vi.fn()
const mockCloseAccessConfig = vi.fn()
const toastMocks = vi.hoisted(() => {
  const record = vi.fn()
  const api = Object.assign(
    vi.fn((message: unknown, options?: Record<string, unknown>) => record({ message, ...options })),
    {
      success: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'success', message, ...options }),
      ),
      error: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'error', message, ...options }),
      ),
      warning: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'warning', message, ...options }),
      ),
      info: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'info', message, ...options }),
      ),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    },
  )
  return { record, api }
})

vi.mock('@/app/notifications', () => ({
  toast: toastMocks.api,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

let mockConsoleState = {
  isCurrentWorkspaceDatasetOperator: false,
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}

const render = (ui: Parameters<typeof renderWithConsoleState>[0]) => {
  const queryClient = createAccountProfileQueryClient(mockConsoleState.userProfile)
  return renderWithConsoleState(ui, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => mockConsoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => mockConsoleState)
})
vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')

  return createSystemFeaturesStateModuleMock(() => mockConsoleState)
})

vi.mock('../hooks/use-dataset-card-state', () => ({
  useDatasetCardState: () => ({
    modalState: {
      showRenameModal: false,
      showConfirmDelete: false,
      showAccessConfig: false,
      confirmMessage: '',
    },
    openRenameModal: vi.fn(),
    closeRenameModal: vi.fn(),
    closeConfirmDelete: vi.fn(),
    openAccessConfig: mockOpenAccessConfig,
    closeAccessConfig: mockCloseAccessConfig,
    handleExportPipeline: vi.fn(),
    detectIsUsedByApp: vi.fn(),
    onConfirmDelete: vi.fn(),
  }),
}))

// Modal workflows are tested at their owner boundary.
vi.mock('../components/dataset-card-modals', () => ({ default: () => null }))
vi.mock('@/features/tag-management/components/dataset-card-tags', () => ({
  DatasetCardTags: ({ canBindOrUnbindTags }: { canBindOrUnbindTags?: boolean }) => (
    <button
      type="button"
      data-testid="tag-area"
      data-can-bind-or-unbind-tags={String(Boolean(canBindOrUnbindTags))}
    />
  ),
}))
vi.mock('../components/operations-dropdown', () => ({
  default: ({
    stepByStepTourHighlightPart,
    stepByStepTourOpen,
  }: {
    openAccessConfig?: () => void
    stepByStepTourHighlightPart?: string
    stepByStepTourOpen?: boolean
  }) => (
    <div
      data-testid="operations-dropdown"
      data-step-by-step-tour-highlight-part={stepByStepTourHighlightPart}
      data-step-by-step-tour-open={String(stepByStepTourOpen)}
    />
  ),
}))

const createMockDataset = (
  overrides: Partial<DatasetDetailWithPartialMembersResponse> = {},
): DatasetDetailWithPartialMembersResponse => createDatasetFixture(overrides)

describe('DatasetCard Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState = {
      isCurrentWorkspaceDatasetOperator: false,
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: [],
    }
  })

  describe('Step-by-step tour targets', () => {
    it('should expose card and operations targets for the Knowledge walkthrough', () => {
      const dataset = createMockDataset()

      const { container } = render(
        <DatasetCard
          dataset={dataset}
          stepByStepTourActionMenuHighlightPart={
            STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCardActionsMenu
          }
          stepByStepTourActionMenuOpen
          stepByStepTourCardTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCard}
        />,
      )

      expect(
        container.querySelector(
          `[data-step-by-step-tour-target="${STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCard}"]`,
        ),
      ).toBeInTheDocument()
      expect(screen.getByTestId('operations-dropdown')).toHaveAttribute(
        'data-step-by-step-tour-highlight-part',
        STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsFirstCardActionsMenu,
      )
      expect(screen.getByTestId('operations-dropdown')).toHaveAttribute(
        'data-step-by-step-tour-open',
        'true',
      )
    })
  })
})

describe('DatasetCard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState = {
      isCurrentWorkspaceDatasetOperator: false,
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: [],
    }
  })

  it('exposes the document entry as a named link reachable by keyboard', async () => {
    const user = userEvent.setup()
    const dataset = createMockDataset()
    render(<DatasetCard dataset={dataset} />)

    const link = screen.getByRole('link', { name: dataset.name })
    expect(link).toHaveAttribute('href', '/datasets/dataset-1/documents')
    await user.tab()
    expect(link).toHaveFocus()
    expect(screen.getByTestId('tag-area').closest('a')).toBeNull()
  })

  it('explains preview-only access and withholds editing controls', async () => {
    const user = userEvent.setup()
    const dataset = createMockDataset({
      name: 'Preview Only Dataset',
      permission_keys: [DatasetACLPermission.Preview],
      tags: [{ id: 'tag-preview', name: 'Readonly Tag', type: 'knowledge' as const }],
    })
    render(<DatasetCard dataset={dataset} />)

    const card = screen.getByRole('button', { name: 'Preview Only Dataset' })
    expect(screen.queryByRole('link', { name: dataset.name })).not.toBeInTheDocument()
    expect(card).not.toHaveAttribute('aria-disabled')
    expect(screen.getByText('Preview Only Dataset')).toBeInTheDocument()
    const tagArea = screen.getByTestId('tag-area')
    expect(tagArea).toHaveAttribute('data-can-bind-or-unbind-tags', 'false')
    expect(screen.queryByTestId('operations-dropdown')).not.toBeInTheDocument()

    await user.click(card)

    expect(mockPush).not.toHaveBeenCalled()
    expect(toastMocks.record).toHaveBeenCalledWith({
      type: 'warning',
      message: 'app.noAccessResourcePermission',
    })
  })

  it('explains preview-only access through the keyboard without exposing a detail link', async () => {
    const user = userEvent.setup()
    const dataset = createMockDataset({
      provider: 'external',
      permission_keys: [DatasetACLPermission.Preview],
    })
    render(<DatasetCard dataset={dataset} />)

    const entry = screen.getByRole('button', { name: 'Test Dataset' })
    expect(screen.queryByRole('link', { name: 'Test Dataset' })).not.toBeInTheDocument()
    await user.tab()
    expect(entry).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(mockPush).not.toHaveBeenCalled()
    expect(toastMocks.record).toHaveBeenCalledWith({
      type: 'warning',
      message: 'app.noAccessResourcePermission',
    })
    await user.keyboard(' ')
    expect(toastMocks.record).toHaveBeenCalledTimes(2)
  })

  it('should navigate to hitTesting for external provider', () => {
    const dataset = createMockDataset({
      provider: 'external',
      permission_keys: ['dataset.acl.retrieval_recall'],
    })
    render(<DatasetCard dataset={dataset} />)

    expect(screen.getByRole('link', { name: dataset.name })).toHaveAttribute(
      'href',
      '/datasets/dataset-1/hitTesting',
    )
  })

  it('should navigate to settings for external provider when retrieval recall permission is missing', () => {
    const dataset = createMockDataset({
      provider: 'external',
      permission_keys: [],
    })
    render(<DatasetCard dataset={dataset} />)

    expect(screen.getByRole('link', { name: dataset.name })).toHaveAttribute(
      'href',
      '/datasets/dataset-1/settings',
    )
  })

  it('should navigate to pipeline for unpublished pipeline', () => {
    const dataset = createMockDataset({ runtime_mode: 'rag_pipeline', is_published: false })
    render(<DatasetCard dataset={dataset} />)

    expect(screen.getByRole('link', { name: dataset.name })).toHaveAttribute(
      'href',
      '/datasets/dataset-1/pipeline',
    )
  })

  it('should allow tag binding when dataset has edit ACL', () => {
    const dataset = createMockDataset({ permission_keys: ['dataset.acl.edit'] })

    render(<DatasetCard dataset={dataset} />)

    expect(screen.getByTestId('tag-area')).toHaveAttribute('data-can-bind-or-unbind-tags', 'true')
  })

  it('should allow tag binding with workspace dataset tag management permission', () => {
    mockConsoleState = {
      isCurrentWorkspaceDatasetOperator: false,
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: ['dataset.tag.manage'],
    }
    const dataset = createMockDataset({ permission_keys: ['dataset.acl.readonly'] })

    render(<DatasetCard dataset={dataset} />)

    expect(screen.getByTestId('tag-area')).toHaveAttribute('data-can-bind-or-unbind-tags', 'true')
  })

  it('should not allow tag binding when dataset lacks edit ACL', () => {
    const dataset = createMockDataset({ permission_keys: ['dataset.acl.readonly'] })

    render(<DatasetCard dataset={dataset} />)

    expect(screen.getByTestId('tag-area')).toHaveAttribute('data-can-bind-or-unbind-tags', 'false')
  })
})
