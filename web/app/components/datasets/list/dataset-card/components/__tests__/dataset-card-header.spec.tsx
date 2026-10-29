import { render, screen } from '@testing-library/react'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import DatasetCardHeader from '../dataset-card-header'

describe('DatasetCardHeader', () => {
  it('shows the dataset name and indexing mode', () => {
    render(<DatasetCardHeader dataset={createDatasetFixture({ name: 'Product docs' })} />)

    expect(screen.getByText('Product docs')).toBeInTheDocument()
    expect(screen.getByText('dataset.chunkingMode.general')).toBeInTheDocument()
    expect(
      screen.getByText(
        'dataset.indexingTechnique.high_quality · dataset.indexingMethod.semantic_search',
      ),
    ).toBeInTheDocument()
  })

  it('identifies an external knowledge base', () => {
    render(<DatasetCardHeader dataset={createDatasetFixture({ provider: 'external' })} />)

    expect(screen.getByText('dataset.externalKnowledgeBase')).toBeInTheDocument()
  })

  it('identifies a multimodal dataset', () => {
    render(<DatasetCardHeader dataset={createDatasetFixture({ is_multimodal: true })} />)

    expect(screen.getByText('dataset.multimodal')).toBeInTheDocument()
  })

  it('hides indexing details for an unpublished pipeline', () => {
    render(
      <DatasetCardHeader
        dataset={createDatasetFixture({
          runtime_mode: 'rag_pipeline',
          is_published: false,
        })}
      />,
    )

    expect(screen.getByText('dataset.cornerLabel.pipeline')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'dataset.indexingTechnique.high_quality · dataset.indexingMethod.semantic_search',
      ),
    ).not.toBeInTheDocument()
  })
})
