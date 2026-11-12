import type { ContactImIntegrationView } from '../types'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { providerMetadata, toDetailView } from '../credentials'
import { ContactEmailConfigContent } from '../email-config-dialog'
import { channelSummary, emailDetail } from './fixtures/channel-client'
import { json } from './fixtures/http'

const network = vi.hoisted(() => ({
  handle: vi.fn<(request: Request) => Promise<Response> | Response>(),
}))
vi.mock('@/service/base', async () => {
  const { httpErrorFromResponse } = await import('@/service/http-error')
  return {
    request: async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const response = await network.handle(options.request)
      if (!response.ok) throw await httpErrorFromResponse(response)
      return response
    },
  }
})
vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))
vi.mock('@/context/i18n', async (original) => ({
  ...(await original<typeof import('@/context/i18n')>()),
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

const email = channelSummary({ id: 'channel-email', kind: 'email', provider: 'resend' })
const clients: QueryClient[] = []
const apiPath = '/workspaces/current/human-input/v2/channels/email'
const saveLabel = 'contacts.imPlatform.action.save'
const testLabel = 'contacts.imPlatform.action.testConnection'
const secretLabel = 'contacts.imPlatform.email.apiKey'

function EmailSession({ integration }: { integration: ContactImIntegrationView | null }) {
  const [open, setOpen] = useState(true)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <ContactEmailConfigContent
          integration={integration}
          provider={{
            provider: 'resend',
            displayName: 'Email',
            requiredFields: providerMetadata.resend.fields,
          }}
          onOpenChange={setOpen}
        />
      </DialogContent>
    </Dialog>
  )
}

function renderEmail(
  integration: ContactImIntegrationView | null = toDetailView(emailDetail(email)),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <EmailSession integration={integration} />
    </QueryClientProvider>,
  )
}

function requests(method: string, ending: string) {
  return network.handle.mock.calls
    .map(([request]) => request)
    .filter(
      (request) => request.method === method && new URL(request.url).pathname.endsWith(ending),
    )
}

beforeEach(() => {
  network.handle.mockImplementation((request) => {
    const path = new URL(request.url).pathname
    if (path.endsWith('/test'))
      return json({ status: 'connected', status_description: 'Connected' })
    if (request.method === 'GET') return json(emailDetail(email))
    return json({ summary: email })
  })
})
afterEach(() => clients.splice(0).forEach((client) => client.clear()))

it('tests a new Email draft without saving it, then creates the channel on save', async () => {
  const user = userEvent.setup()
  renderEmail(null)
  await user.type(
    await screen.findByLabelText('contacts.imPlatform.email.senderEmail'),
    'sender@example.test',
  )
  await user.type(screen.getByLabelText('contacts.imPlatform.email.senderName'), '  Approvals  ')
  await user.type(screen.getByLabelText(secretLabel), '  new-api-key  ')
  await user.click(screen.getByRole('button', { name: testLabel }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('contacts.imPlatform.email.testSucceeded'),
  )
  const [testRequest] = requests('POST', `${apiPath}/test`)
  expect(await testRequest?.json()).toEqual({
    sender_email: 'sender@example.test',
    sender_name: 'Approvals',
    credentials: { provider: 'resend', api_key: 'new-api-key' },
  })
  expect(requests('POST', apiPath)).toHaveLength(0)
  expect(screen.getByLabelText(secretLabel)).toHaveValue('  new-api-key  ')

  await user.click(screen.getByRole('button', { name: saveLabel }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const [saveRequest] = requests('POST', apiPath)
  expect(await saveRequest?.json()).toEqual({
    sender_email: 'sender@example.test',
    sender_name: 'Approvals',
    credentials: { provider: 'resend', api_key: 'new-api-key' },
  })
})

it('retains a saved API key for connection tests and updates while invalidating stale test success', async () => {
  const user = userEvent.setup()
  renderEmail()
  await user.click(await screen.findByRole('button', { name: testLabel }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('contacts.imPlatform.email.testSucceeded'),
  )
  const [testRequest] = requests('POST', `${apiPath}/${email.id}/test`)
  expect(await testRequest?.json()).toEqual({
    expected_config_version: email.config_version,
    sender_email: 'sender@example.test',
    sender_name: 'Approvals',
    credentials: { provider: 'resend', api_key: { type: 'unchanged' } },
  })

  const name = screen.getByLabelText('contacts.imPlatform.email.senderName')
  await user.clear(name)
  await user.type(name, 'New sender')
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  await user.click(screen.getByRole('button', { name: saveLabel }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const [saveRequest] = requests('PUT', `${apiPath}/${email.id}`)
  expect(await saveRequest?.json()).toEqual({
    expected_config_version: email.config_version,
    sender_email: 'sender@example.test',
    sender_name: 'New sender',
    credentials: { provider: 'resend', api_key: { type: 'unchanged' } },
  })
})

it('shows a failed provider test, keeps the draft, and lets corrected credentials be tested again', async () => {
  let connected = false
  network.handle.mockImplementation(() =>
    json({
      status: connected ? 'connected' : 'invalid_credentials',
      status_description: connected ? 'Connected' : 'The API key was rejected',
    }),
  )
  const user = userEvent.setup()
  renderEmail()
  const secret = await screen.findByLabelText(secretLabel)
  await user.type(secret, 'rejected-key')
  await user.click(screen.getByRole('button', { name: testLabel }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The API key was rejected')
  expect(secret).toHaveValue('rejected-key')
  expect(screen.getByRole('status')).toBeEmptyDOMElement()

  connected = true
  await user.clear(secret)
  await user.type(secret, 'corrected-key')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: testLabel }))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('contacts.imPlatform.email.testSucceeded'),
  )
  const testRequests = requests('POST', `${apiPath}/${email.id}/test`)
  expect(testRequests).toHaveLength(2)
  expect(await testRequests[1]?.json()).toMatchObject({
    credentials: { api_key: 'corrected-key' },
  })
  expect(requests('PUT', `${apiPath}/${email.id}`)).toHaveLength(0)
})

it('preserves a rejected Email save for correction and retries with the current sender and secret', async () => {
  let rejectSave = true
  network.handle.mockImplementation((request) => {
    if (request.method === 'GET') return json(emailDetail(email))
    return rejectSave
      ? json({ code: 'bad_request', message: 'Sender domain is not verified' }, 400)
      : json({ summary: email })
  })
  const user = userEvent.setup()
  renderEmail()
  const secret = await screen.findByLabelText(secretLabel)
  await user.type(secret, 'retry-key')
  await user.click(screen.getByRole('button', { name: saveLabel }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sender domain is not verified')
  expect(secret).toHaveValue('retry-key')

  rejectSave = false
  const sender = screen.getByLabelText('contacts.imPlatform.email.senderEmail')
  await user.clear(sender)
  await user.type(sender, 'verified@example.test')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: saveLabel }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const saves = requests('PUT', `${apiPath}/${email.id}`)
  expect(saves).toHaveLength(2)
  expect(await saves[1]?.json()).toMatchObject({
    sender_email: 'verified@example.test',
    credentials: { api_key: 'retry-key' },
  })
})

it('clears the API key and prevents duplicate writes when save succeeds but fresh details cannot load', async () => {
  network.handle.mockImplementation((request) =>
    request.method === 'GET'
      ? json({ code: 'unavailable', message: 'Details unavailable' }, 503)
      : json({ summary: email }),
  )
  const user = userEvent.setup()
  renderEmail()
  const secret = await screen.findByLabelText(secretLabel)
  await user.type(secret, 'saved-key')
  await user.click(screen.getByRole('button', { name: saveLabel }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'contacts.imPlatform.bindingDialog.savedDetailsUnavailable',
  )
  expect(secret).toHaveValue('')
  expect(secret).toBeDisabled()
  expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled()
  expect(screen.getByRole('button', { name: testLabel })).toBeDisabled()
  expect(requests('PUT', `${apiPath}/${email.id}`)).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
