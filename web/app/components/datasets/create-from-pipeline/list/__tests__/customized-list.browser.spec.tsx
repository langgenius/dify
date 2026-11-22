import type { PipelineTemplateListResponse } from '@dify/contracts/api/console/rag/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRef } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import List from '..'
import Header from '../../header'

const { getTemplates, deleteTemplate } = vi.hoisted(() => ({
  getTemplates: vi.fn(),
  deleteTemplate: vi.fn(),
}))

vi.mock('@/next/link', () => ({
  default: ({
    children,
    replace: _replace,
    ...props
  }: React.ComponentProps<'a'> & { replace?: boolean }) => <a {...props}>{children}</a>,
}))
// boundary: Marketplace availability is deployment-specific and unrelated to customized templates.
vi.mock('@/features/marketplace/client', () => ({ useMarketplace: () => null }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipeline.templates.get': getTemplates,
      'rag.pipeline.customized.templates.byTemplateId.delete': deleteTemplate,
    }),
  }
})

const original = {
  id: 'template-1',
  name: 'Legal documents',
  description: 'Process legal documents',
  chunk_structure: 'text_model',
  position: 1,
  icon: { icon_type: 'emoji', icon: '📚', icon_background: '#FFF4ED' },
} satisfies PipelineTemplateListResponse['pipeline_templates'][number]

function Fixture({ client }: { client: QueryClient }) {
  const fallbackFocusRef = useRef<HTMLAnchorElement>(null)
  return (
    <QueryClientProvider client={client}>
      <Header backLinkRef={fallbackFocusRef} />
      <div className="w-80">
        <List fallbackFocusRef={fallbackFocusRef} />
      </div>
    </QueryClientProvider>
  )
}

async function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: false },
    },
  })
  return { client, screen: await render(<Fixture client={client} />) }
}

async function openDeletion(screen: Awaited<ReturnType<typeof render>>) {
  await userEvent.tab()
  await expect
    .element(screen.getByRole('link', { name: 'datasetPipeline.creation.backToKnowledge' }))
    .toHaveFocus()
  await userEvent.tab()
  await userEvent.tab()
  await userEvent.tab()
  const more = screen.getByRole('button', { name: 'common.operation.more' })
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard('{End}')
  const deleteItem = screen.getByRole('menuitem', { name: 'common.operation.delete' })
  await expect.element(deleteItem).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('alertdialog', { name: 'datasetPipeline.deletePipeline.title' })
  await expect.element(dialog).toBeVisible()
  return dialog
}

beforeEach(() => {
  getTemplates.mockReset().mockResolvedValue({ pipeline_templates: [original] })
  deleteTemplate.mockReset()
})

it('keeps the chosen deletion target when a background refresh reorders the list', async () => {
  const { client, screen } = await setup()
  const dialog = await openDeletion(screen)
  const other = { ...original, id: 'template-2', name: 'Invoices' }
  getTemplates.mockResolvedValueOnce({ pipeline_templates: [other, original] })
  await client.invalidateQueries({
    queryKey: consoleQuery.rag.pipeline.templates.get.queryKey({
      input: { query: { type: 'customized' } },
    }),
  })
  await expect.element(screen.getByText('Invoices')).toBeVisible()
  getTemplates.mockResolvedValue({ pipeline_templates: [other] })
  deleteTemplate.mockResolvedValue({ result: 'success' })

  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()

  await expect.element(dialog).not.toBeInTheDocument()
  expect(deleteTemplate).toHaveBeenCalledExactlyOnceWith({ params: { template_id: original.id } })
  await expect.element(screen.getByText('Invoices')).toBeVisible()
  await expect.element(screen.getByText(original.name)).not.toBeInTheDocument()
})

it('protects the request, supports an in-place retry, and closes before the refresh', async () => {
  const request = createDeferred()
  const retry = createDeferred<{ result: string }>()
  const refresh = createDeferred<PipelineTemplateListResponse>()
  deleteTemplate.mockReturnValueOnce(request.promise).mockReturnValueOnce(retry.promise)
  const { screen } = await setup()
  const dialog = await openDeletion(screen)
  const cancel = dialog.getByRole('button', { name: 'common.operation.cancel' })
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  await expect.element(cancel).toHaveFocus()

  // Two activations before React paints the loading state must still send a single DELETE.
  const button = confirm.element() as HTMLButtonElement
  button.focus()
  button.click()
  button.click()
  await expect.element(cancel).toBeDisabled()
  await expect.element(confirm).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  expect(deleteTemplate).toHaveBeenCalledTimes(1)

  request.reject(new Error('Request failed'))
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Request failed')
  await expect.element(cancel).toBeEnabled()
  getTemplates.mockReturnValue(refresh.promise)
  await userEvent.keyboard('{Enter}')
  await expect.element(cancel).toBeDisabled()
  retry.resolve({ result: 'success' })

  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(original.name)).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('link', { name: 'datasetPipeline.creation.backToKnowledge' }))
    .toHaveFocus()
  expect(deleteTemplate).toHaveBeenCalledTimes(2)
  refresh.resolve({ pipeline_templates: [] })
})

it('allows Escape without deleting while an ordinary list refresh is in flight', async () => {
  const refresh = createDeferred<PipelineTemplateListResponse>()
  const { client, screen } = await setup()
  const dialog = await openDeletion(screen)
  getTemplates.mockReturnValue(refresh.promise)
  const fetching = client.invalidateQueries()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'common.operation.more' })).toHaveFocus()
  expect(deleteTemplate).not.toHaveBeenCalled()
  refresh.resolve({ pipeline_templates: [original] })
  await fetching
})

it('lets a reopened page delete a different template while the previous request finishes', async () => {
  const firstRequest = createDeferred<{ result: string }>()
  const secondRequest = createDeferred<{ result: string }>()
  deleteTemplate
    .mockReturnValueOnce(firstRequest.promise)
    .mockReturnValueOnce(secondRequest.promise)
  const { client, screen } = await setup()
  const dialog = await openDeletion(screen)
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  const cancel = dialog.getByRole('button', { name: 'common.operation.cancel' })
  await confirm.click()
  await expect.element(cancel).toBeDisabled()

  const other = { ...original, id: 'template-2', name: 'Invoices' }
  getTemplates.mockResolvedValue({ pipeline_templates: [other] })
  await client.invalidateQueries()
  await screen.rerender(<Fixture key="reopened" client={client} />)
  await expect.element(screen.getByText(other.name)).toBeVisible()
  await openDeletion(screen)
  await expect.element(cancel).toBeEnabled()
  await confirm.click()
  await expect.element(cancel).toBeDisabled()
  expect(deleteTemplate).toHaveBeenNthCalledWith(2, { params: { template_id: other.id } })

  getTemplates.mockResolvedValue({ pipeline_templates: [] })
  secondRequest.resolve({ result: 'success' })
  await expect.element(dialog).not.toBeInTheDocument()
  firstRequest.resolve({ result: 'success' })
})
