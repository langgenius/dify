import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import DatasetDetailLayout from './layout-main'

let mockPathname = '/datasets/dataset-1/documents'
let mockDataset: Partial<DataSet> | undefined = {
  id: 'dataset-1',
  name: 'Pipeline Dataset',
  provider: 'vendor',
  runtime_mode: 'rag_pipeline',
  is_published: false,
  indexing_technique: IndexingType.QUALIFIED,
  document_count: 2,
}

const mockSetAppSidebarExpand = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/app/components/app-sidebar', () => ({
  default: ({ navigation }: { navigation: Array<{ name: string, disabled?: boolean }> }) => (
    <div data-testid="app-sidebar">
      {navigation.map(item => (
        <div
          key={item.name}
          data-testid={`nav-${item.name}`}
          data-disabled={String(Boolean(item.disabled))}
        >
          {item.name}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

vi.mock('@/app/components/datasets/extra-info', () => ({
  default: () => <div data-testid="extra-info" />,
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { setAppSidebarExpand: typeof mockSetAppSidebarExpand }) => unknown) => selector({
    setAppSidebarExpand: mockSetAppSidebarExpand,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceDatasetOperator: true,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: vi.fn(),
    },
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'pc',
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetDetail: () => ({
    data: mockDataset,
    error: undefined,
    refetch: vi.fn(),
  }),
  useDatasetRelatedApps: () => ({
    data: [],
  }),
}))

describe('DatasetDetailLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPathname = '/datasets/dataset-1/documents'
    mockDataset = {
      id: 'dataset-1',
      name: 'Pipeline Dataset',
      provider: 'vendor',
      runtime_mode: 'rag_pipeline',
      is_published: false,
      indexing_technique: IndexingType.QUALIFIED,
      document_count: 2,
    }
  })

  it('should keep documents navigation enabled when rag pipeline is unpublished', () => {
    render(
      <DatasetDetailLayout datasetId="dataset-1">
        <div>content</div>
      </DatasetDetailLayout>,
    )

    expect(screen.getByTestId('nav-common.datasetMenus.documents')).toHaveAttribute('data-disabled', 'false')
    expect(screen.getByTestId('nav-common.datasetMenus.hitTesting')).toHaveAttribute('data-disabled', 'true')
  })
})
