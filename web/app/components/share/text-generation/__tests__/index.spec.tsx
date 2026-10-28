import type { ReactNode } from 'react'
import type { WebAppEntryState } from '../../webapp-entry'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vite-plus/test'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { AppSourceType, sendCompletionMessage, sendWorkflowMessage } from '@/service/share'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { WebAppEntryContext } from '../../webapp-entry'
import TextGeneration from '../index'

const { searchParams, acceptCSV } = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  acceptCSV: { current: (_payload: { data: string[][] }) => {} },
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => searchParams,
  usePathname: () => '/completion/share-code',
  useParams: () => ({ token: 'share-code' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('@/i18n/client', () => ({ changeLanguage: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/app/components/base/amplitude/web-app-event', () => ({ trackWebAppEvent: vi.fn() }))

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchSavedMessage: vi.fn().mockResolvedValue({ data: [] }),
  sendCompletionMessage: vi.fn().mockResolvedValue(undefined),
  sendWorkflowMessage: vi.fn().mockResolvedValue(undefined),
}))

// CSV parsing is an external SDK boundary; the upload wrapper, batch owner and results stay real.
vi.mock('react-papaparse', () => ({
  useCSVReader: () => ({
    CSVReader: ({
      onUploadAccepted,
      children,
    }: {
      onUploadAccepted: typeof acceptCSV.current
      children: (context: { getRootProps: () => object; acceptedFile: null }) => ReactNode
    }) => {
      acceptCSV.current = onUploadAccepted
      return children({ getRootProps: () => ({}), acceptedFile: null })
    },
  }),
  useCSVDownloader: () => ({
    CSVDownloader: ({ children }: { children: ReactNode }) => <>{children}</>,
    Type: { Link: 'link' },
  }),
}))

function renderGeneration({
  ready = true,
  installed = false,
  workflow = false,
  entry = null,
}: {
  ready?: boolean
  installed?: boolean
  workflow?: boolean
  entry?: WebAppEntryState | null
} = {}) {
  if (ready) {
    useWebAppStore.setState({
      appInfo: {
        app_id: 'app-1',
        mode: workflow ? 'workflow' : 'completion',
        custom_config: null,
        site: { title: 'Generator', description: 'Description', default_language: 'en-US' },
      },
      appParams: createChatConfigFixture({
        user_input_form: [
          {
            'text-input': {
              label: 'Name',
              variable: 'name',
              required: true,
              max_length: 48,
              default: '',
              hide: false,
            },
          },
        ],
      }),
      webAppAccessMode: AccessMode.PUBLIC,
    })
  }
  return renderWithConsoleQuery(
    <WebAppEntryContext value={entry}>
      <TextGeneration isInstalledApp={installed} isWorkflow={workflow} />
    </WebAppEntryContext>,
    {
      systemFeatures: { branding: { enabled: false, workspace_logo: '' } },
    },
  )
}

beforeEach(() => {
  searchParams.delete('mode')
  window.history.replaceState({}, '', '/')
})

describe('TextGeneration', () => {
  beforeEach(() => {
    useWebAppStore.setState(useWebAppStore.getInitialState(), true)
    const stopGuard = guardUnexpectedFetch()
    onTestFinished(stopGuard)
  })

  it('shows loading until app metadata is ready', () => {
    renderGeneration({ ready: false })
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('falls back to the create tab for an unsupported mode in an installed app', async () => {
    searchParams.set('mode', 'unsupported')
    renderGeneration({ installed: true })
    expect(
      await screen.findByRole('tab', { name: 'share.generation.tabs.create' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'share.generation.tabs.batch' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('runs the entered inputs and displays the streamed completion', async () => {
    const user = userEvent.setup()
    renderGeneration()
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Alice')
    await user.click(screen.getByRole('button', { name: 'share.generation.run' }))
    await waitFor(() =>
      expect(sendCompletionMessage).toHaveBeenCalledWith(
        { inputs: { name: 'Alice' } },
        expect.any(Object),
        AppSourceType.webApp,
        'app-1',
      ),
    )
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    const handlers = vi.mocked(sendCompletionMessage).mock.calls[0]![1]
    act(() => {
      handlers.onData?.('Hello Alice', false, { messageId: 'message-1', taskId: 'task-1' })
      handlers.onCompleted?.()
    })
    expect(await screen.findByText('Hello Alice')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('runs accepted CSV rows through the batch owner and renders their results', async () => {
    const user = userEvent.setup()
    searchParams.set('mode', 'batch')
    renderGeneration()
    const batch = await screen.findByRole('tabpanel', { name: 'share.generation.tabs.batch' })
    act(() => acceptCSV.current({ data: [['Name'], ['Alice']] }))
    await user.click(within(batch).getByRole('button', { name: 'share.generation.run' }))
    await waitFor(() =>
      expect(sendCompletionMessage).toHaveBeenCalledWith(
        { inputs: { name: 'Alice' } },
        expect.any(Object),
        AppSourceType.webApp,
        'app-1',
      ),
    )
    expect(screen.getByText('share.generation.executions:{"num":1}')).toBeInTheDocument()
    const handlers = vi.mocked(sendCompletionMessage).mock.calls[0]![1]
    act(() => {
      handlers.onData?.('Batch result for Alice', false, {
        messageId: 'message-1',
        taskId: 'task-1',
      })
      handlers.onCompleted?.()
    })
    expect(await screen.findByText('Batch result for Alice')).toBeInTheDocument()
    expect(within(batch).getByRole('button', { name: 'share.generation.run' })).toBeEnabled()
  })
})

describe('Workflow connections entry', () => {
  it('requires explicit connection confirmation and only persists the checked selection with a real Workflow run', async () => {
    window.history.replaceState({}, '', '/workflow/share-code')
    const user = userEvent.setup()
    const id = '11111111-1111-4111-8111-111111111111'
    const revision = '22222222-2222-4222-8222-222222222222'
    const checkedRevision = '33333333-3333-4333-8333-333333333333'
    const connection = {
      id,
      name: 'Personal GitHub',
      provider: 'langgenius/github/github',
      account_label: null,
      credential_type: 'api-key',
      credential_status: 'connected',
      expires_at: null,
      created_at: 1,
      updated_at: 1,
      last_active_at: 1,
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      const path = new URL(request.url).pathname
      if (path.endsWith('/connections/configuration'))
        return Response.json({ connections: { source: connection } })
      if (path.endsWith('/connections/preflight'))
        return Response.json({
          connection_revision: checkedRevision,
          ready: true,
          connections: [{ node_id: 'source', connection_id: id, status: 'connected', check: null }],
        })
      if (path.endsWith('/connections'))
        return Response.json({ data: [connection], has_more: false, next_cursor: null })
      throw new Error(`Unexpected request: ${request.method} ${path}`)
    })
    renderGeneration({
      workflow: true,
      entry: {
        status: 'connections-pending',
        account: 'authenticated',
        canRun: false,
        showSignIn: false,
        parameters: {
          account_login_enabled: true,
          account_login_url: 'https://account.example/signin',
          allow_anonymous_end_user_auth: false,
          connection_revision: revision,
          requires_end_user_connections: true,
          connection_requirements: [
            {
              node_id: 'source',
              node_ids: ['source'],
              provider: connection.provider,
              allowed_credential_types: ['api-key'],
              plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
              title: 'Research',
              purpose: 'Look up repositories',
              icon: '/github.svg',
              icon_dark: null,
            },
          ],
        },
      },
    })
    const start = await screen.findByRole('button', {
      name: 'share.connections.setup.startUsingApp',
    })
    await waitFor(() => expect(start).toBeEnabled())
    expect(sendWorkflowMessage).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
    await user.click(start)
    expect(sendWorkflowMessage).not.toHaveBeenCalled()
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Alice')
    await user.click(screen.getByRole('button', { name: 'share.generation.run' }))
    await waitFor(() =>
      expect(sendWorkflowMessage).toHaveBeenCalledExactlyOnceWith(
        {
          inputs: { name: 'Alice' },
          connection_revision: checkedRevision,
          connections: { source: id },
        },
        expect.any(Object),
        AppSourceType.webApp,
        'app-1',
      ),
    )
  })
})
