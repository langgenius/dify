import type { DataSet } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetCardFooter from '../components/dataset-card-footer'
import Description from '../components/description'
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

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks.api,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

let mockAppContextState = {
  isCurrentWorkspaceDatasetOperator: false,
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(importOriginal, () => mockAppContextState)
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

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
})

vi.mock('../components/corner-labels', () => ({
  default: () => <div data-testid="corner-labels" />,
}))
vi.mock('../components/dataset-card-header', () => ({
  default: ({ dataset }: { dataset: DataSet }) => (
    <div data-testid="card-header">{dataset.name}</div>
  ),
}))
vi.mock('../components/dataset-card-modals', () => ({
  default: ({ onCloseAccessConfig }: { onCloseAccessConfig?: () => void }) => (
    <div
      data-testid="card-modals"
      data-has-close-access-config={typeof onCloseAccessConfig === 'function'}
    />
  ),
}))
vi.mock('@/features/tag-management/components/dataset-card-tags', () => ({
  DatasetCardTags: ({
    onClick,
    canBindOrUnbindTags,
  }: {
    onClick: (e: React.MouseEvent) => void
    canBindOrUnbindTags?: boolean
  }) => (
    <div
      data-testid="tag-area"
      data-can-bind-or-unbind-tags={String(Boolean(canBindOrUnbindTags))}
      onClick={onClick}
    />
  ),
}))
vi.mock('../components/operations-dropdown', () => ({
  default: ({
    openAccessConfig,
    stepByStepTourHighlightPart,
    stepByStepTourOpen,
  }: {
    openAccessConfig?: () => void
    stepByStepTourHighlightPart?: string
    stepByStepTourOpen?: boolean
  }) => (
    <div
      data-testid="operations-dropdown"
      data-has-open-access-config={typeof openAccessConfig === 'function'}
      data-step-by-step-tour-highlight-part={stepByStepTourHighlightPart}
      data-step-by-step-tour-open={String(stepByStepTourOpen)}
    />
  ),
}))

// Factory function for DataSet mock data
const createMockDataset = (overrides: Partial<DataSet> = {}): DataSet =>
  ({
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    provider: 'vendor',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    embedding_available: true,
    app_count: 5,
    document_count: 10,
    word_count: 1000,
    created_at: 1609459200,
    updated_at: 1609545600,
    tags: [],
    embedding_model: 'text-embedding-ada-002',
    embedding_model_provider: 'openai',
    created_by: 'user-1',
    doc_form: ChunkingMode.text,
    total_available_documents: 10,
    runtime_mode: 'general',
    ...overrides,
  }) as DataSet

describe('DatasetCard Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContextState = {
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

  // Integration tests for Description component
  describe('Description', () => {
    describe('Rendering', () => {
      it('should render description text from dataset', () => {
        const dataset = createMockDataset({ description: 'My knowledge base' })
        render(<Description dataset={dataset} />)
        expect(screen.getByText('My knowledge base')).toBeInTheDocument()
      })

      it('should set title attribute to description', () => {
        const dataset = createMockDataset({ description: 'Hover text' })
        render(<Description dataset={dataset} />)
        expect(screen.getByTitle('Hover text')).toBeInTheDocument()
      })
    })

    describe('Props', () => {
      it('should apply opacity-30 when embedding_available is false', () => {
        const dataset = createMockDataset({ embedding_available: false })
        render(<Description dataset={dataset} />)
        const descDiv = screen.getByTitle(dataset.description)
        expect(descDiv).toHaveClass('opacity-30')
      })

      it('should not apply opacity-30 when embedding_available is true', () => {
        const dataset = createMockDataset({ embedding_available: true })
        render(<Description dataset={dataset} />)
        const descDiv = screen.getByTitle(dataset.description)
        expect(descDiv).not.toHaveClass('opacity-30')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty description', () => {
        const dataset = createMockDataset({ description: '' })
        render(<Description dataset={dataset} />)
        const descDiv = screen.getByTitle('')
        expect(descDiv).toBeInTheDocument()
        expect(descDiv).toHaveTextContent('')
      })

      it('should handle long description', () => {
        const longDesc = 'X'.repeat(500)
        const dataset = createMockDataset({ description: longDesc })
        render(<Description dataset={dataset} />)
        expect(screen.getByText(longDesc)).toBeInTheDocument()
      })
    })
  })

  // Integration tests for DatasetCardFooter component
  describe('DatasetCardFooter', () => {
    describe('Rendering', () => {
      it('should render document count', () => {
        const dataset = createMockDataset({ document_count: 15, total_available_documents: 15 })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('15')).toBeInTheDocument()
      })

      it('should render app count for non-external provider', () => {
        const dataset = createMockDataset({ app_count: 7, provider: 'vendor' })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('7')).toBeInTheDocument()
      })

      it('should render update time', () => {
        const dataset = createMockDataset()
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText(/updated/i)).toBeInTheDocument()
      })
    })

    describe('Props', () => {
      it('should show partial count when total_available_documents < document_count', () => {
        const dataset = createMockDataset({
          document_count: 20,
          total_available_documents: 12,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('12 / 20')).toBeInTheDocument()
      })

      it('should show single count when all documents are available', () => {
        const dataset = createMockDataset({
          document_count: 20,
          total_available_documents: 20,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('20')).toBeInTheDocument()
      })

      it('should not show app count when provider is external', () => {
        const dataset = createMockDataset({ provider: 'external', app_count: 99 })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.queryByText('99')).not.toBeInTheDocument()
      })

      it('should have opacity when embedding_available is false', () => {
        const dataset = createMockDataset({ embedding_available: false })
        const { container } = render(<DatasetCardFooter dataset={dataset} />)
        const footer = container.firstChild as HTMLElement
        expect(footer).toHaveClass('opacity-30')
      })
    })

    describe('Edge Cases', () => {
      it('should handle undefined total_available_documents', () => {
        const dataset = createMockDataset({
          document_count: 10,
          total_available_documents: undefined,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        // total_available_documents defaults to 0, which is < 10
        expect(screen.getByText('0 / 10')).toBeInTheDocument()
      })

      it('should handle zero document count', () => {
        const dataset = createMockDataset({
          document_count: 0,
          total_available_documents: 0,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('0')).toBeInTheDocument()
      })

      it('should handle large numbers', () => {
        const dataset = createMockDataset({
          document_count: 100000,
          total_available_documents: 100000,
          app_count: 50000,
        })
        render(<DatasetCardFooter dataset={dataset} />)
        expect(screen.getByText('100000')).toBeInTheDocument()
        expect(screen.getByText('50000')).toBeInTheDocument()
      })
    })
  })
})

describe('DatasetCard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContextState = {
      isCurrentWorkspaceDatasetOperator: false,
      userProfile: { id: 'user-1' },
      workspacePermissionKeys: [],
    }
  })

  it('should render and navigate to documents when clicked', () => {
    const dataset = createMockDataset()
    render(<DatasetCard dataset={dataset} />)

    fireEvent.click(screen.getByText('Test Dataset'))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/documents')
  })

  it('should render preview-only dataset as a dimmed information-only card', () => {
    const dataset = createMockDataset({
      name: 'Preview Only Dataset',
      permission_keys: [DatasetACLPermission.Preview],
      tags: [
        { id: 'tag-preview', name: 'Readonly Tag', type: 'knowledge' as const, binding_count: '' },
      ],
    })
    render(<DatasetCard dataset={dataset} />)

    const card = screen.getByRole('button', { name: 'Preview Only Dataset' })
    expect(card).toHaveClass('opacity-60')
    expect(card).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Preview Only Dataset')).toBeInTheDocument()
    const tagArea = screen.getByTestId('tag-area')
    expect(tagArea).toHaveAttribute('data-can-bind-or-unbind-tags', 'false')
    expect(screen.queryByTestId('operations-dropdown')).not.toBeInTheDocument()

    fireEvent.click(tagArea)

    expect(mockPush).not.toHaveBeenCalled()
    expect(toastMocks.record).not.toHaveBeenCalled()

    fireEvent.click(card)

    expect(mockPush).not.toHaveBeenCalled()
    expect(toastMocks.record).toHaveBeenCalledWith({
      type: 'warning',
      message: 'app.noAccessResourcePermission',
    })
  })

  it('should not navigate preview-only external dataset to a detail page', () => {
    const dataset = createMockDataset({
      provider: 'external',
      permission_keys: [DatasetACLPermission.Preview],
    })
    render(<DatasetCard dataset={dataset} />)

    fireEvent.click(screen.getByRole('button', { name: 'Test Dataset' }))

    expect(mockPush).not.toHaveBeenCalled()
    expect(toastMocks.record).toHaveBeenCalledWith({
      type: 'warning',
      message: 'app.noAccessResourcePermission',
    })
  })

  it('should use the hover background treatment', () => {
    const dataset = createMockDataset()
    render(<DatasetCard dataset={dataset} />)
    const card = screen.getByText('Test Dataset').closest('[data-disable-nprogress]')

    expect(card).toHaveClass('bg-components-card-bg')
    expect(card).toHaveClass('hover:bg-components-card-bg-alt')
  })

  it('should pass access config handlers to operations and modals', () => {
    const dataset = createMockDataset()
    render(<DatasetCard dataset={dataset} />)

    expect(screen.getByTestId('operations-dropdown')).toHaveAttribute(
      'data-has-open-access-config',
      'true',
    )
    expect(screen.getByTestId('card-modals')).toHaveAttribute(
      'data-has-close-access-config',
      'true',
    )
  })

  it('should navigate to hitTesting for external provider', () => {
    const dataset = createMockDataset({
      provider: 'external',
      permission_keys: ['dataset.acl.retrieval_recall'],
    })
    render(<DatasetCard dataset={dataset} />)

    fireEvent.click(screen.getByText('Test Dataset'))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/hitTesting')
  })

  it('should navigate to settings for external provider when retrieval recall permission is missing', () => {
    const dataset = createMockDataset({
      provider: 'external',
      permission_keys: [],
    })
    render(<DatasetCard dataset={dataset} />)

    fireEvent.click(screen.getByText('Test Dataset'))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/settings')
  })

  it('should navigate to pipeline for unpublished pipeline', () => {
    const dataset = createMockDataset({ runtime_mode: 'rag_pipeline', is_published: false })
    render(<DatasetCard dataset={dataset} />)

    fireEvent.click(screen.getByText('Test Dataset'))
    expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-1/pipeline')
  })

  it('should stop propagation when tag area is clicked', () => {
    const dataset = createMockDataset()
    render(<DatasetCard dataset={dataset} />)

    const tagArea = screen.getByTestId('tag-area')
    fireEvent.click(tagArea)
    // Tag area click should not trigger card navigation
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('should allow tag binding when dataset has edit ACL', () => {
    const dataset = createMockDataset({ permission_keys: ['dataset.acl.edit'] })

    render(<DatasetCard dataset={dataset} />)

    expect(screen.getByTestId('tag-area')).toHaveAttribute('data-can-bind-or-unbind-tags', 'true')
  })

  it('should allow tag binding with workspace dataset tag management permission', () => {
    mockAppContextState = {
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
