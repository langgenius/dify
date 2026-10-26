import type { AppData } from '@/models/share'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { fetchAppInfo } from '@/service/share'
import { shareQueryKeys } from '@/service/use-share'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import MigrateConversationsContent from '../content'

vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchAppInfo: vi.fn(),
}))

const appInfo = {
  app_id: 'current-app',
  custom_config: null,
  site: {
    title: 'Research Assistant',
    description: 'Search and organize research for this workspace.',
    icon_type: 'emoji',
    icon: '🔬',
    icon_background: '#E0F2FE',
  },
} satisfies AppData

beforeEach(() => {
  vi.mocked(fetchAppInfo).mockReset()
  window.history.replaceState({}, '', '/chat/current-app/migrate-conversations')
})

afterEach(() => {
  window.history.replaceState({}, '', '/')
})

it('loads the current WebApp metadata instead of another app or the preview data', async () => {
  const request = createDeferred<AppData>()
  vi.mocked(fetchAppInfo).mockReturnValueOnce(request.promise)
  const queryClient = createTestQueryClient()
  const previousApp = { ...appInfo, site: { ...appInfo.site, title: 'Previous App' } }
  queryClient.setQueryData(shareQueryKeys.appInfo(null), previousApp)
  queryClient.setQueryData(
    shareQueryKeys.appInfo({ kind: 'default', code: 'previous-app' }),
    previousApp,
  )

  render(
    <QueryClientProvider client={queryClient}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Previous App' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'login.history.continue' })).not.toBeInTheDocument()

  request.resolve(appInfo)

  expect(await screen.findByRole('heading', { name: appInfo.site.title })).toBeInTheDocument()
  expect(screen.getByText(appInfo.site.description)).toBeInTheDocument()
  expect(screen.getByText('🔬')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'login.history.continue' })).toBeDisabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Writing Assistant' })).not.toBeInTheDocument()
})

it('shows a load failure instead of confirmation actions when the WebApp cannot be loaded', async () => {
  vi.mocked(fetchAppInfo).mockRejectedValueOnce(new Error('Service unavailable'))

  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MigrateConversationsContent />
    </QueryClientProvider>,
  )

  expect(await screen.findByText('share.common.appUnknownError')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'login.history.continue' })).not.toBeInTheDocument()
})
