import type { DataSet } from '@/models/datasets'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it.each([
    {
      available: 15,
      total: 20,
      count: '15 / 20',
      description: 'dataset.partialEnabled:{"count":20,"num":15}',
    },
    { available: 20, total: 20, count: '20', description: 'dataset.docAllEnabled:{"count":20}' },
  ])(
    'opens document availability using the keyboard ($count)',
    async ({ available, total, count, description }) => {
      const user = userEvent.setup()
      render(
        <DatasetCardFooter
          dataset={createDataset({ total_available_documents: available, document_count: total })}
        />,
      )

      await user.tab()
      const trigger = screen.getByRole('button', { name: `${count} common.datasetMenus.documents` })
      expect(trigger).toHaveFocus()
      await user.keyboard('{Enter}')

      const details = await screen.findByRole('dialog', { name: 'common.datasetMenus.documents' })
      expect(within(details).getByText(description)).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(trigger).toHaveFocus()
    },
  )

  it('opens linked app details with Space', async () => {
    const user = userEvent.setup()
    render(<DatasetCardFooter dataset={createDataset()} />)

    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: '5 dataset.appCount' })).toHaveFocus()
    await user.keyboard(' ')

    expect(await screen.findByRole('dialog', { name: '5 dataset.appCount' })).toBeInTheDocument()
  })

  it('opens document details by click without activating the surrounding card', async () => {
    const user = userEvent.setup()
    const onDocumentClick = vi.fn()
    render(<DatasetCardFooter dataset={createDataset()} />)
    document.addEventListener('click', onDocumentClick)

    try {
      await user.click(screen.getByRole('button', { name: '10 common.datasetMenus.documents' }))
      const details = await screen.findByRole('dialog', { name: 'common.datasetMenus.documents' })
      await user.click(within(details).getByText('dataset.docAllEnabled:{"count":10}'))
      expect(onDocumentClick).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('click', onDocumentClick)
    }
  })

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
