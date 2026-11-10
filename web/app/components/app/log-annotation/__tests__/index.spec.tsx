import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { screen } from '@testing-library/react'
import { Suspense } from 'react'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import LogAnnotation from '../index'

vi.mock('@/app/components/app/annotation', () => ({
  default: ({ appDetail }: { appDetail: AppDetailWithSite }) => (
    <section aria-label="Annotation log">{appDetail.id}</section>
  ),
}))

vi.mock('@/app/components/app/log', () => ({
  default: ({ appDetail }: { appDetail: AppDetailWithSite }) => (
    <section aria-label="App log">{appDetail.id}</section>
  ),
}))

vi.mock('@/app/components/app/workflow-log', () => ({
  default: ({ appDetail }: { appDetail: AppDetailWithSite }) => (
    <section aria-label="Workflow log">{appDetail.id}</section>
  ),
}))

const createMockApp = (overrides: Partial<AppDetailWithSite> = {}): AppDetailWithSite =>
  createAppDetailFixture({
    id: 'app-123',
    name: 'Test App',
    mode: 'chat',
    site: createAppSiteFixture({ access_token: 'token', app_base_url: 'https://example.com' }),
    ...overrides,
  })

let appDetail: AppDetailWithSite | undefined
const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => {
  const queryClient = createConsoleQueryClient()
  if (appDetail)
    queryClient.setQueryData(
      consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: appDetail.id } } }),
      appDetail,
    )
  return renderWithConsoleQuery(<Suspense fallback={<div>Loading logs</div>}>{ui}</Suspense>, {
    queryClient,
  })
}

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: vi.fn(() => new Promise(() => {})),
}))

describe('LogAnnotation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appDetail = createMockApp()
  })

  // Rendering behavior
  describe('Rendering', () => {
    it('should render loading state when app detail is missing', () => {
      // Arrange
      appDetail = undefined

      // Act
      render(<LogAnnotation appId="app-123" pageType={PageType.log} />)

      // Assert
      expect(screen.getByText('Loading logs')).toBeInTheDocument()
    })
  })

  it.each(['chat', 'completion', 'workflow'] as const)('selects the correct log for %s', (mode) => {
    appDetail = createMockApp({ mode })
    render(<LogAnnotation appId="app-123" pageType={PageType.log} />)
    expect(
      screen.getByRole('region', { name: mode === 'workflow' ? 'Workflow log' : 'App log' }),
    ).toHaveTextContent('app-123')
    expect(screen.queryByRole('region', { name: 'Annotation log' })).not.toBeInTheDocument()
  })

  // Prop-driven behavior
  describe('Props', () => {
    it('should render annotation content when page type is annotation', () => {
      // Arrange
      appDetail = createMockApp({ mode: 'chat' })

      // Act
      render(<LogAnnotation appId="app-123" pageType={PageType.annotation} />)

      // Assert
      expect(screen.getByRole('region', { name: 'Annotation log' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'App log' })).not.toBeInTheDocument()
    })
  })
})

it('shows the destination log mode and app identity after navigation', () => {
  appDetail = createMockApp({ mode: 'chat' })
  const { queryClient, rerender } = render(
    <LogAnnotation appId="app-123" pageType={PageType.log} />,
  )
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'workflow-app' } } }),
    createMockApp({ id: 'workflow-app', mode: 'workflow' }),
  )
  expect(screen.getByRole('region', { name: 'App log' })).toHaveTextContent('app-123')
  rerender(<LogAnnotation appId="workflow-app" pageType={PageType.log} />)
  expect(screen.getByRole('region', { name: 'Workflow log' })).toHaveTextContent('workflow-app')
  expect(screen.queryByRole('region', { name: 'App log' })).not.toBeInTheDocument()
})

it('surfaces an initial detail error instead of staying in the loading state', async () => {
  const queryClient = createConsoleQueryClient()
  const queryKey = consoleQuery.apps.byAppId.get.queryKey({
    input: { params: { app_id: 'unavailable-app' } },
  })
  await queryClient
    .query({ queryKey, queryFn: () => Promise.reject(new Error('Detail unavailable')) })
    .catch(() => {})
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    renderWithConsoleQuery(
      <ErrorBoundary>
        <Suspense fallback={<div>Loading logs</div>}>
          <LogAnnotation appId="unavailable-app" pageType={PageType.log} />
        </Suspense>
      </ErrorBoundary>,
      { queryClient },
    )
    expect(
      await screen.findByRole('button', { name: 'common.errorBoundary.tryAgain' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Loading logs')).not.toBeInTheDocument()
  } finally {
    consoleError.mockRestore()
  }
})
