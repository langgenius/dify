import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import DatasetCardFooter from '../dataset-card-footer'

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => 'recently',
  }),
}))

const createDataset = (overrides: Partial<DataSet> = {}): DataSet =>
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
    ...overrides,
  }) as DataSet

describe('DatasetCardFooter', () => {
  it('shows the number of available documents when only part of a dataset is enabled', () => {
    render(
      <DatasetCardFooter
        dataset={createDataset({
          document_count: 20,
          total_available_documents: 15,
        })}
      />,
    )

    expect(screen.getByText('15 / 20')).toBeInTheDocument()
  })

  it('shows the application count for an internal dataset', () => {
    render(<DatasetCardFooter dataset={createDataset({ app_count: 8 })} />)

    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('does not show an application count for an external dataset', () => {
    render(
      <DatasetCardFooter
        dataset={createDataset({
          app_count: 8,
          document_count: 2,
          provider: 'external',
          total_available_documents: 2,
        })}
      />,
    )

    expect(screen.queryByText('8')).not.toBeInTheDocument()
  })
})
