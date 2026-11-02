import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import DatasetCardFooter from '../dataset-card-footer'

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => 'recently',
  }),
}))

const createDataset = (overrides: Parameters<typeof createDatasetFixture>[0] = {}) =>
  createDatasetFixture({
    app_count: 5,
    document_count: 10,
    total_available_documents: 10,
    ...overrides,
  })

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
