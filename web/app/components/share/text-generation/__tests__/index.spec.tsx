import type { ReactNode } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vite-plus/test'
import { useWebAppStore } from '@/context/web-app-context'
import { AccessMode } from '@/models/access-control'
import { AppSourceType, sendCompletionMessage } from '@/service/share'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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

function renderGeneration({ ready = true, installed = false } = {}) {
  if (ready) {
    useWebAppStore.setState({
      appInfo: {
        app_id: 'app-1',
        mode: 'completion',
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
  return renderWithConsoleQuery(<TextGeneration isInstalledApp={installed} />, {
    systemFeatures: { branding: { enabled: false, workspace_logo: '' } },
  })
}

beforeEach(() => {
  searchParams.delete('mode')
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
