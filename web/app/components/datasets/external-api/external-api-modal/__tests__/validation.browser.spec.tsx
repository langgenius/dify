import type { consoleClient } from '@/service/console'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import common from '@/i18n/locales/en-US/common.json'
import dataset from '@/i18n/locales/en-US/dataset.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import AddExternalAPIModal from '../index'
import { response } from './fixtures'

vi.unmock('react-i18next')
const api = vi.hoisted(() => ({
  create: vi.fn<typeof consoleClient.datasets.externalKnowledgeApi.post>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'datasets.externalKnowledgeApi.post': api.create,
    }),
  }
})
beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  api.create.mockReset()
})

async function setup(endpoint: string, key = 'secret-key') {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, dataset } },
  })
  const { wrapper: Providers } = createConsoleQueryWrapper()
  function Caller() {
    const [open, setOpen] = useState(true)
    return (
      <>
        {open && (
          <AddExternalAPIModal
            isEditMode={false}
            onSave={() => {}}
            onCancel={() => setOpen(false)}
          />
        )}
        <AppToaster />
      </>
    )
  }
  const screen = await render(
    <Providers>
      <I18nextProvider i18n={i18n}>
        <Caller />
      </I18nextProvider>
    </Providers>,
  )
  await screen.getByLabelText(/Name/).fill('Product API')
  await screen.getByLabelText(/API Endpoint/).fill(endpoint)
  await screen.getByLabelText(/API Key/).fill(key)
  return screen
}

it('reports a short key without discarding the draft or sending a request', async () => {
  const screen = await setup('https://api.example.com', 'key')
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(screen.getByText('API-key length cannot be less than 5 characters'))
    .toBeVisible()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await expect.element(screen.getByLabelText(/Name/)).toHaveValue('Product API')
  expect(api.create).not.toHaveBeenCalled()
})

it('focuses and describes the invalid endpoint, then clears the error when corrected', async () => {
  api.create.mockResolvedValue(response)
  const screen = await setup('not-a-url')
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  const endpoint = screen.getByLabelText(/API Endpoint/)
  await expect.element(endpoint).toHaveFocus()
  await expect.element(endpoint).toHaveAttribute('aria-invalid', 'true')
  await expect.element(endpoint).toHaveAccessibleDescription('Enter a valid http(s) URL.')
  expect(api.create).not.toHaveBeenCalled()
  await endpoint.fill('https://api.example.com')
  await expect.element(screen.getByText('Enter a valid http(s) URL.')).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})
