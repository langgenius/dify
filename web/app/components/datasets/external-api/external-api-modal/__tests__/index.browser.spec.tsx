import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { consoleClient } from '@/service/console'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { ExternalApiDialogContent } from '../dialog-content'
import { useSaveExternalApi } from '../use-save-external-api'
import { data, response } from './fixtures'

const api = vi.hoisted(() => ({
  edit: vi.fn<typeof consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.patch>(),
  create: vi.fn<typeof consoleClient.datasets.externalKnowledgeApi.post>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.externalKnowledgeApi.byExternalKnowledgeApiId.patch': api.edit,
      'datasets.externalKnowledgeApi.post': api.create,
    }),
  }
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  api.edit.mockReset().mockResolvedValue(response)
  api.create.mockReset().mockResolvedValue(response)
})

async function setup(existing?: ExternalKnowledgeApiResponse) {
  const { wrapper: Providers } = createConsoleQueryWrapper()
  function Caller() {
    const save = useSaveExternalApi()
    const [open, setOpen] = useState(true)
    const [saved, setSaved] = useState<ExternalKnowledgeApiResponse>()
    return (
      <>
        <Dialog open={open} onOpenChange={setOpen}>
          <ExternalApiDialogContent
            api={existing}
            pending={save.isPending}
            onSubmit={(body) =>
              save.mutate(
                { id: existing?.id, body },
                {
                  onSuccess: (saved) => {
                    setSaved(saved)
                    setOpen(false)
                  },
                },
              )
            }
          />
        </Dialog>
        {saved && <p>Saved {saved.name}</p>}
        <AppToaster />
      </>
    )
  }
  return render(
    <Providers>
      <Caller />
    </Providers>,
  )
}
type Screen = Awaited<ReturnType<typeof setup>>
async function fill(
  screen: Screen,
  endpoint = data.settings.endpoint,
  key = data.settings.api_key,
) {
  await screen.getByLabelText(/Name/).fill(data.name)
  await screen.getByLabelText(/API Endpoint/).fill(endpoint)
  await screen.getByLabelText(/API Key/).fill(key)
}
const save = (screen: Screen) =>
  screen.getByRole('button', { name: 'dataset.externalAPIForm.save' })

it('submits the entered settings and returns the saved API before closing', async () => {
  const screen = await setup()
  await expect.element(save(screen)).toBeDisabled()
  await expect
    .element(screen.getByRole('link', { name: 'dataset.externalAPIPanelDocumentation' }))
    .toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/self-host/use-dify/knowledge/external-knowledge-api',
    )
  await fill(screen)
  await save(screen).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(screen.getByText('Saved Product API')).toBeVisible()
  expect(api.create).toHaveBeenCalledExactlyOnceWith({ body: data }, { context: { silent: true } })
})

it('preserves entered settings after a failed creation and lets the user retry', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => errors.mockRestore())
  api.create.mockRejectedValueOnce(new Error('Offline'))
  const screen = await setup()
  await fill(screen)
  await save(screen).click()
  await expect.element(screen.getByText('common.api.actionFailed')).toBeVisible()
  // The failure toast is also a dialog; name the form so the query does not wait for it to close.
  const form = screen.getByRole('dialog', { name: 'dataset.createExternalAPI' })
  await expect.element(form).toBeVisible()
  await expect.element(screen.getByLabelText(/API Endpoint/)).toHaveValue(data.settings.endpoint)
  await save(screen).click()
  await expect.element(form).not.toBeInTheDocument()
  await expect.element(screen.getByText('Saved Product API')).toBeVisible()
})

it.each([false, true])(
  'saves an edited API with dataset confirmation only when bound (%s)',
  async (bound) => {
    const screen = await setup({
      ...response,
      dataset_bindings: bound ? [{ id: 'ds-1', name: 'Guide' }] : [],
    })
    await screen.getByLabelText(/Name/).fill('Product API updated')
    await save(screen).click()
    if (bound) {
      const confirm = screen.getByRole('alertdialog')
      await expect.element(confirm).toBeVisible()
      expect(api.edit).not.toHaveBeenCalled()
      await confirm.getByRole('button', { name: 'common.operation.cancel' }).click()
      await expect.element(confirm).not.toBeInTheDocument()
      await expect.element(save(screen)).toHaveFocus()
      await save(screen).click()
      await confirm.getByRole('button', { name: 'common.operation.confirm' }).click()
    }
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(api.edit).toHaveBeenCalledExactlyOnceWith(
      {
        params: { external_knowledge_api_id: response.id },
        body: { ...data, name: 'Product API updated' },
      },
      { context: { silent: true } },
    )
    expect(api.create).not.toHaveBeenCalled()
  },
)

it.each(['dataset.externalAPIForm.cancel', 'common.operation.close'])(
  'dismisses the form without saving through %s',
  async (name) => {
    const screen = await setup()
    await fill(screen)
    await screen.getByRole('button', { name }).click()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(api.create).not.toHaveBeenCalled()
  },
)

it('validates a bound API before confirmation and locks the draft while saving', async () => {
  const request = createDeferred<ExternalKnowledgeApiResponse>()
  api.edit.mockReturnValueOnce(request.promise)
  const screen = await setup({ ...response, dataset_bindings: [{ id: 'ds', name: 'Guide' }] })
  const endpoint = screen.getByLabelText(/API Endpoint/)
  await endpoint.fill('invalid')
  await save(screen).click()
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  expect(api.edit).not.toHaveBeenCalled()
  await endpoint.fill(data.settings.endpoint)
  await save(screen).click()
  const confirm = screen.getByRole('alertdialog')
  await confirm.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(confirm).not.toBeInTheDocument()
  await expect.element(endpoint).toBeDisabled()
  request.resolve(response)
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  expect(api.edit).toHaveBeenCalledTimes(1)
})
