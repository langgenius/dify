import type { PipelineTemplateListResponse } from '@dify/contracts/api/console/rag/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRef } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import List from '..'
import Header from '../../header'

vi.mock('@/next/link', () => ({
  default: ({
    children,
    replace: _replace,
    ...props
  }: React.ComponentProps<'a'> & { replace?: boolean }) => <a {...props}>{children}</a>,
}))
const original = {
  id: 'template-1',
  name: 'Legal documents',
  description: 'Process legal documents',
  chunk_structure: 'text_model',
  position: 1,
  icon: { icon_type: 'emoji', icon: '📚', icon_background: '#FFF4ED' },
} satisfies PipelineTemplateListResponse['pipeline_templates'][number]
const other = { ...original, id: 'template-2', name: 'Invoices' }
let templates: (typeof original)[]
// Marketplace availability is deployment-specific and unrelated to customized templates.
const systemFeatures = createSystemFeaturesFixture({ enable_marketplace: false })
const fake = setupFakeApi({
  console: {
    systemFeatures: { get: () => systemFeatures },
    rag: {
      pipeline: {
        templates: { get: () => ({ pipeline_templates: templates }) },
        customized: {
          templates: {
            byTemplateId: {
              delete: ({ params }) => {
                templates = templates.filter((template) => template.id !== params.template_id)
              },
            },
          },
        },
      },
    },
  },
})
const listTemplates = () => fake.console.rag.pipeline.templates.get
const deleteTemplate = () => fake.console.rag.pipeline.customized.templates.byTemplateId.delete

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
  client.setQueryData(systemFeaturesQueryOptions().queryKey, systemFeatures)
  const { NavigationProvider } = createTestNavigation({ url: '/datasets/create-from-pipeline' })
  return {
    client,
    screen: await render(<Fixture client={client} />, { wrapper: NavigationProvider }),
  }
}

async function openDeletion(screen: Awaited<ReturnType<typeof render>>) {
  const more = screen.getByRole('button', { name: 'common.operation.more' })
  // The template list arrives over the network; tab through it only once it has rendered.
  await expect.element(more).toBeInTheDocument()
  await userEvent.tab()
  await expect
    .element(screen.getByRole('link', { name: 'datasetPipeline.creation.backToKnowledge' }))
    .toHaveFocus()
  await userEvent.tab()
  await userEvent.tab()
  await userEvent.tab()
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
  templates = [original]
})

it('keeps the chosen deletion target when a background refresh reorders the list', async () => {
  const { client, screen } = await setup()
  const dialog = await openDeletion(screen)
  templates = [other, original]
  await client.invalidateQueries({
    queryKey: consoleQuery.rag.pipeline.templates.get.queryKey({
      input: { query: { type: 'customized' } },
    }),
  })
  await expect.element(screen.getByText('Invoices')).toBeVisible()
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()

  await expect.element(dialog).not.toBeInTheDocument()
  expect(deleteTemplate()).toHaveBeenCalledExactlyOnceWith({ params: { template_id: original.id } })
  await expect.element(screen.getByText('Invoices')).toBeVisible()
  await expect.element(screen.getByText(original.name)).not.toBeInTheDocument()
})

it('protects the request, supports an in-place retry, and closes before the refresh', async () => {
  const request = hold(deleteTemplate())
  const retry = hold(deleteTemplate())
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
  await request.arrived
  expect(deleteTemplate()).toHaveBeenCalledTimes(1)

  request.reject(apiError({ status: 500, message: 'Request failed' }))
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Request failed')
  await expect.element(cancel).toBeEnabled()
  await userEvent.keyboard('{Enter}')
  await expect.element(cancel).toBeDisabled()
  await retry.arrived
  const refresh = hold(listTemplates())
  retry.release()

  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText(original.name)).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('link', { name: 'datasetPipeline.creation.backToKnowledge' }))
    .toHaveFocus()
  expect(deleteTemplate()).toHaveBeenCalledTimes(2)
  refresh.release()
})

it('allows Escape without deleting while an ordinary list refresh is in flight', async () => {
  const { client, screen } = await setup()
  const dialog = await openDeletion(screen)
  const refresh = hold(listTemplates())
  const fetching = client.invalidateQueries()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'common.operation.more' })).toHaveFocus()
  expect(deleteTemplate()).not.toHaveBeenCalled()
  refresh.release()
  await fetching
})

it('lets a reopened page delete a different template while the previous request finishes', async () => {
  const firstRequest = hold(deleteTemplate())
  const secondRequest = hold(deleteTemplate())
  const { client, screen } = await setup()
  const dialog = await openDeletion(screen)
  const confirm = dialog.getByRole('button', { name: 'common.operation.confirm' })
  const cancel = dialog.getByRole('button', { name: 'common.operation.cancel' })
  await confirm.click()
  await expect.element(cancel).toBeDisabled()

  await firstRequest.arrived
  templates = [other]
  await client.invalidateQueries()
  await screen.rerender(<Fixture key="reopened" client={client} />)
  await expect.element(screen.getByText(other.name)).toBeVisible()
  await openDeletion(screen)
  await expect.element(cancel).toBeEnabled()
  await confirm.click()
  await expect.element(cancel).toBeDisabled()
  expect(await secondRequest.arrived).toEqual({ params: { template_id: other.id } })
  expect(deleteTemplate()).toHaveBeenCalledTimes(2)

  secondRequest.release()
  await expect.element(dialog).not.toBeInTheDocument()
  firstRequest.release()
})
