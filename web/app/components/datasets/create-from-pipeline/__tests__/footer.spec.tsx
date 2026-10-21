import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import Footer from '../footer'

const mocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), importDSL: vi.fn() }))
let searchParams = new URLSearchParams()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => searchParams,
}))
vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({ handleCheckPluginDependencies: vi.fn() }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipelines.imports.post': mocks.importDSL,
    }),
  }
})
beforeEach(() => {
  searchParams = new URLSearchParams()
})

it.each([false, true])(
  'opens the import form with remote URL = %s and clears the URL on cancel',
  async (remote) => {
    const user = userEvent.setup()
    if (remote) searchParams.set('remoteInstallUrl', 'https://example.com/documents.pipeline')
    render(<Footer />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'datasetPipeline.creation.importDSL' }))
    expect(await screen.findByRole('dialog', { name: 'app.importFromDSL' })).toBeInTheDocument()
    if (remote) {
      expect(screen.getByRole('tab', { name: 'app.importFromDSLUrl' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByRole('textbox', { name: 'DSL URL' })).toHaveValue(
        'https://example.com/documents.pipeline',
      )
    } else {
      expect(screen.getByRole('tab', { name: 'app.importFromDSLFile' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    }
    await user.click(screen.getByRole('button', { name: 'app.newApp.Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    if (remote) expect(mocks.replace).toHaveBeenCalledWith('/datasets/create-from-pipeline')
    else expect(mocks.replace).not.toHaveBeenCalled()
  },
)

it('invalidates the dataset list after a successful DSL import and opens the new pipeline', async () => {
  const user = userEvent.setup()
  searchParams.set('remoteInstallUrl', 'https://example.com/documents.pipeline')
  mocks.importDSL.mockResolvedValue({
    id: 'import-1',
    status: 'completed',
    dataset_id: 'dataset-1',
    pipeline_id: 'pipeline-1',
  })
  const { queryClient } = render(<Footer />)
  const listKey = consoleQuery.datasets.get.queryKey({ input: { query: { page: 1, limit: 20 } } })
  queryClient.setQueryData(listKey, { data: [], has_more: false, limit: 20, page: 1, total: 0 })
  await user.click(screen.getByRole('button', { name: 'datasetPipeline.creation.importDSL' }))
  await user.click(screen.getByRole('button', { name: 'app.newApp.import' }))
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/datasets/dataset-1/pipeline'))
  expect(mocks.importDSL).toHaveBeenCalledWith({
    body: { mode: 'yaml-url', yaml_url: 'https://example.com/documents.pipeline' },
  })
  expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
