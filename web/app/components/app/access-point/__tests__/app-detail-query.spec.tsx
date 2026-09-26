import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppSiteFixture } from '@/test/fixtures/app'
import { appPublisherAppDetailAtom, AppPublisherStateBoundary } from '../../app-publisher/state'
import { appDeployAppDetailAtom, AppDeployStateBoundary } from '../../deploy/state'
import { useAccessPointActions } from '../shared/use-access-point-actions'
import { accessPointAppDetailAtom, AccessPointStateBoundary } from '../state'

const saveSite = vi.hoisted(() => vi.fn())
const serverApps = new Map<string, AppDetailWithSite>()

vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: async (url: string, _init: RequestInit, { request }: { request: Request }) => {
    const appId = new URL(url).pathname.match(/\/apps\/([^/]+)/)?.[1]
    const app = appId ? serverApps.get(appId) : undefined
    if (!app) throw new Error(`Unexpected app request: ${url}`)
    if (request.method === 'GET') return Response.json(app)
    if (request.method === 'POST' && url.endsWith('/site')) {
      const body = await request.json()
      await saveSite()
      const site = createAppSiteFixture({ ...app.site, ...body })
      serverApps.set(app.id, { ...app, site })
      return Response.json(site)
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`)
  },
}))

function AccessPointReader({ appId }: { appId: string }) {
  const detail = useAtomValue(accessPointAppDetailAtom)
  const { saveSiteConfig } = useAccessPointActions(appId, true)
  return (
    <>
      <p>{`Access Point: ${detail?.name} / ${detail?.site?.title}`}</p>
      <button onClick={() => void saveSiteConfig({ title: 'Updated site' })}>Save site</button>
    </>
  )
}
function DeployReader() {
  const detail = useAtomValue(appDeployAppDetailAtom)
  return <p>{`Deploy: ${detail?.name} / ${detail?.site?.title}`}</p>
}
function PublisherReader() {
  const detail = useAtomValue(appPublisherAppDetailAtom)
  return <p>{`Publisher: ${detail?.name} / ${detail?.site?.title}`}</p>
}
function FeatureReaders({ accessAppId = 'app-1' }: { accessAppId?: string }) {
  return (
    <>
      <AccessPointStateBoundary appId={accessAppId}>
        <AccessPointReader appId={accessAppId} />
      </AccessPointStateBoundary>
      <AppDeployStateBoundary appId="app-1">
        <DeployReader />
      </AppDeployStateBoundary>
      <AppPublisherStateBoundary appId="app-2">
        <PublisherReader />
      </AppPublisherStateBoundary>
    </>
  )
}
function renderReaders() {
  const queryClient = createConsoleQueryClient()
  for (const [id, name] of [
    ['app-1', 'First'],
    ['app-2', 'Second'],
  ] as const) {
    const detail = seedAppDetail(queryClient, {
      id,
      name,
      site: createAppSiteFixture({ title: 'Original site' }),
    })
    serverApps.set(id, detail)
  }
  return renderWithConsoleQuery(<FeatureReaders />, { queryClient })
}

describe('feature AppDetail query ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serverApps.clear()
    saveSite.mockResolvedValue(undefined)
  })

  it('refreshes every feature reading the saved app without changing another app', async () => {
    const user = userEvent.setup()
    renderReaders()
    await user.click(screen.getByRole('button', { name: 'Save site' }))
    expect(await screen.findByText('Access Point: First / Updated site')).toBeInTheDocument()
    expect(screen.getByText('Deploy: First / Updated site')).toBeInTheDocument()
    expect(screen.getByText('Publisher: Second / Original site')).toBeInTheDocument()
  })

  it('uses a changed atom input immediately while a previous app save is pending', async () => {
    let finishSave!: () => void
    saveSite.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
    )
    const user = userEvent.setup()
    const view = renderReaders()
    await user.click(screen.getByRole('button', { name: 'Save site' }))
    await waitFor(() => expect(saveSite).toHaveBeenCalledOnce())
    view.rerender(<FeatureReaders accessAppId="app-2" />)
    expect(await screen.findByText('Access Point: Second / Original site')).toBeInTheDocument()
    await act(async () => finishSave())
    expect(await screen.findByText('Deploy: First / Updated site')).toBeInTheDocument()
    expect(screen.getByText('Access Point: Second / Original site')).toBeInTheDocument()
    expect(screen.getByText('Publisher: Second / Original site')).toBeInTheDocument()
  })
})
