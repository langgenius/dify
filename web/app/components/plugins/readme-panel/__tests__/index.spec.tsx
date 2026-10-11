import type { Locale } from '@/i18n/locale'
import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createPluginDetail } from '../../plugin-detail-panel/__tests__/endpoint-fixture'
import { ReadmeEntrance } from '../entrance'
import ReadmePanel from '../index'
import { useReadmePanelStore } from '../store'

let mockLocale: Locale = 'en-US'
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => mockLocale,
}))

vi.mock('../../plugin-detail-panel/detail-header', () => ({
  default: ({ detail }: { detail: { name: string } }) => <p>{detail.name}</p>,
}))

const fetchMock = vi.fn<typeof fetch>()

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60 * 1000, retry: 2, retryDelay: 0 },
    },
  })
}

function openPanel(identifier = 'langgenius/test:1.0.0') {
  const detail = { ...createPluginDetail(), plugin_unique_identifier: identifier }
  act(() => useReadmePanelStore.getState().openReadmePanel({ detail }))
  return detail
}

function readmeURL(input: Parameters<typeof fetch>[0]) {
  return new URL(input instanceof Request ? input.url : String(input))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLocale = 'en-US'
  useReadmePanelStore.setState({ currentPanel: undefined })
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => Response.json({ readme: '# Plugin documentation' }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ReadmePanel', () => {
  it.each(['drawer', 'dialog'] as const)(
    'opens the %s from its entrance and closes the active panel',
    async (presentation) => {
      const user = userEvent.setup()
      const detail = createPluginDetail()
      render(
        <>
          <ReadmeEntrance pluginDetail={detail} presentation={presentation} />
          <ReadmePanel />
        </>,
        { queryClient: createQueryClient() },
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()

      await user.click(
        screen.getByRole('button', { name: 'plugin.readmeInfo.needHelpCheckReadme' }),
      )

      expect(
        await screen.findByRole('dialog', { name: 'plugin.readmeInfo.title' }),
      ).toBeInTheDocument()
      expect(
        await screen.findByRole('heading', { name: 'Plugin documentation' }),
      ).toBeInTheDocument()
      expect(screen.getByText(detail.name)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(useReadmePanelStore.getState().currentPanel).toBeUndefined()
    },
  )

  it('shows loading until the requested Readme arrives', async () => {
    let resolveResponse!: (response: Response) => void
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )
    openPanel()
    render(<ReadmePanel />, { queryClient: createQueryClient() })

    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    await act(async () => resolveResponse(Response.json({ readme: '# Loaded documentation' })))

    expect(await screen.findByRole('heading', { name: 'Loaded documentation' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows the empty state when the server has no Readme', async () => {
    fetchMock.mockImplementation(async () => Response.json({ readme: '' }))
    openPanel()
    render(<ReadmePanel />, { queryClient: createQueryClient() })

    expect(await screen.findByText('plugin.readmeInfo.noReadmeAvailable')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows a local error without a toast or automatic retries', async () => {
    const notifyError = vi.spyOn(toast, 'error')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockImplementation(async () =>
      Response.json(
        { code: 'internal_server_error', message: 'Readme unavailable' },
        { status: 500 },
      ),
    )
    openPanel()
    render(<ReadmePanel />, { queryClient: createQueryClient() })

    expect(await screen.findByText('plugin.readmeInfo.failedToFetch')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('does not fetch or stay loading when the panel has no plugin identifier', async () => {
    openPanel('')
    render(<ReadmePanel />, { queryClient: createQueryClient() })

    expect(await screen.findByText('plugin.readmeInfo.noReadmeAvailable')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps plugin versions isolated when an earlier request finishes last', async () => {
    let resolveOldResponse!: (response: Response) => void
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOldResponse = resolve
    })
    fetchMock.mockImplementation(async (input) => {
      const url = readmeURL(input)
      expect(url.pathname).toMatch(/\/workspaces\/current\/plugin\/readme$/)
      return url.searchParams.get('plugin_unique_identifier') === 'langgenius/test:1.0.0'
        ? oldResponse
        : Response.json({ readme: '# Version two' })
    })
    openPanel()
    render(<ReadmePanel />, { queryClient: createQueryClient() })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    openPanel('langgenius/test:2.0.0')
    expect(await screen.findByRole('heading', { name: 'Version two' })).toBeInTheDocument()
    await act(async () => resolveOldResponse(Response.json({ readme: '# Version one' })))

    expect(screen.getByRole('heading', { name: 'Version two' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Version one' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses the real locale conversion and reuses only the matching language cache', async () => {
    const requestedLanguages: Array<string | null> = []
    fetchMock.mockImplementation(async (input) => {
      const url = readmeURL(input)
      expect(url.searchParams.get('plugin_unique_identifier')).toBe('langgenius/test:1.0.0')
      const language = url.searchParams.get('language')
      requestedLanguages.push(language)
      return Response.json({
        readme:
          language === 'zh_Hans'
            ? '# 中文说明'
            : language === 'de_DE'
              ? '# Deutsche Dokumentation'
              : '# English Readme',
      })
    })
    openPanel()
    const { rerender } = render(<ReadmePanel />, { queryClient: createQueryClient() })
    expect(await screen.findByRole('heading', { name: 'English Readme' })).toBeInTheDocument()

    mockLocale = 'zh-Hans'
    rerender(<ReadmePanel />)
    expect(await screen.findByRole('heading', { name: '中文说明' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'English Readme' })).not.toBeInTheDocument()

    mockLocale = 'de-DE'
    rerender(<ReadmePanel />)
    expect(
      await screen.findByRole('heading', { name: 'Deutsche Dokumentation' }),
    ).toBeInTheDocument()

    mockLocale = 'en-US'
    rerender(<ReadmePanel />)
    expect(await screen.findByRole('heading', { name: 'English Readme' })).toBeInTheDocument()
    expect(requestedLanguages).toEqual(['en_US', 'zh_Hans', 'de_DE'])
  })
})
