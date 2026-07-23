import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import CornerLabels from '../corner-labels'

const createDataset = (embeddingAvailable: boolean): DataSet =>
  ({
    id: 'dataset-1',
    name: 'Test Dataset',
    description: 'Test description',
    provider: 'vendor',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    embedding_available: embeddingAvailable,
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
  }) as unknown as DataSet

describe('CornerLabels', () => {
  it('shows that a dataset is unavailable when embedding is unavailable', () => {
    render(<CornerLabels dataset={createDataset(false)} />)

    expect(screen.getByText('dataset.cornerLabel.unavailable')).toBeInTheDocument()
  })

  it('does not label an available dataset', () => {
    const { container } = render(<CornerLabels dataset={createDataset(true)} />)

    expect(container).toBeEmptyDOMElement()
  })
})
