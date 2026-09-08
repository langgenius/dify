import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import CreateAppModal from '@/app/components/app/create-app-modal'
import { DifyBuilderProvider } from '@/app/components/workflow-app/components/dify-builder/provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(async () => ({
    id: 'created-app',
    mode: 'advanced-chat',
    maintainer: 'user-1',
  })),
  push: vi.fn(),
  setShowPanel: vi.fn(),
  setCanvasReadOnly: vi.fn(),
  syncDraft: vi.fn(async () => undefined),
  startBuild: vi.fn(async () => true),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))
vi.mock('@/utils/create-app-tracking', () => ({ trackCreateApp: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleQuery: {
      ...actual.consoleQuery,
      account: actual.consoleQuery.account,
      features: actual.consoleQuery.features,
      systemFeatures: actual.consoleQuery.systemFeatures,
      workspaces: actual.consoleQuery.workspaces,
      apps: {
        ...actual.consoleQuery.apps,
        post: { mutationOptions: () => ({ mutationFn: mocks.createApp }) },
      },
    },
  }
})
vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      setShowDifyBuilderPanel: typeof mocks.setShowPanel
      setCanvasReadOnly: typeof mocks.setCanvasReadOnly
    }) => T,
  ) =>
    selector({
      setShowDifyBuilderPanel: mocks.setShowPanel,
      setCanvasReadOnly: mocks.setCanvasReadOnly,
    }),
}))
vi.mock(
  '@/app/components/workflow-app/components/dify-builder/session/use-session-controller',
  () => ({
    useDifyBuilderSessionController: () => ({ startBuild: mocks.startBuild }),
  }),
)

function CreationFlow() {
  const [created, setCreated] = useState(false)
  return created ? (
    <DifyBuilderProvider
      appId="created-app"
      canEdit
      canStartCreation
      tenantId="workspace-1"
      userId="user-1"
      getCanvasSnapshot={() => ({ nodes: [], edgeCount: 0 })}
      onSyncDraft={mocks.syncDraft}
      onFocusCanvas={() => {}}
      onRefreshCanvas={async () => true}
    >
      <h1>New app editor</h1>
    </DifyBuilderProvider>
  ) : (
    <CreateAppModal show onClose={() => setCreated(true)} />
  )
}

describe('App Builder creation flow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hands the submitted prompt from the creation dialog to the new app and opens its Builder panel', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(<CreationFlow />, {
      accountProfile: { id: 'user-1' },
      features: { dify_builder_enabled: true },
      workspacePermissionKeys: ['app.create_and_management'],
    })

    await user.type(
      screen.getByRole('textbox', { name: 'app.newApp.startFromAppBuilder' }),
      '  Build an expense assistant  ',
    )
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))

    expect(await screen.findByRole('heading', { name: 'New app editor' })).toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.startBuild).toHaveBeenCalledWith(
        'created-app',
        'Build an expense assistant',
        undefined,
      ),
    )
    expect(mocks.push).toHaveBeenCalledWith('/app/created-app/workflow')
    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(mocks.syncDraft).toHaveBeenCalledOnce()
    expect(mocks.createApp).toHaveBeenCalledOnce()
    expect(mocks.createApp).toHaveBeenCalledWith(
      { body: expect.objectContaining({ name: 'app.newApp.defaultName', description: '' }) },
      expect.anything(),
    )
    expect(mocks.startBuild).toHaveBeenCalledOnce()
  })
})
