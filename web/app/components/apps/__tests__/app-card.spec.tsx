import type {
  AppPartial,
  EnvironmentVariableItemResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { InstalledAppListResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type { ReactElement } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { toast } from '@/app/notifications'
import { AccessMode } from '@/models/access-control'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { captureDownloads } from '@/test/download'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import { AppCard } from '../app-card'
import { StarredAppCard } from '../starred-app-card'

const api = vi.hoisted(() => ({
  copy: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.copy.post>(),
  update: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.put>(),
  delete: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.delete>(),
  star: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.star.post>(),
  unstar: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.star.delete>(),
  convert:
    vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.convertToWorkflow.post>(),
  export: vi.fn<typeof import('@/service/console').consoleClient.apps.byAppId.export.get>(),
  env: vi.fn<
    typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.environmentVariables.get
  >(),
  tags: vi.fn<typeof import('@/service/console').consoleClient.tags.get>(),
  bind: vi.fn<typeof import('@/service/console').consoleClient.tagBindings.post>(),
  access: vi.fn<typeof import('@/service/share').getUserCanAccess>(),
  installedRequest:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.copy.post': api.copy,
      'apps.byAppId.put': api.update,
      'apps.byAppId.delete': api.delete,
      'apps.byAppId.star.post': api.star,
      'apps.byAppId.star.delete': api.unstar,
      'apps.byAppId.convertToWorkflow.post': api.convert,
      'apps.byAppId.export.get': api.export,
      'apps.byAppId.workflows.draft.environmentVariables.get': api.env,
      'tags.get': api.tags,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'tagBindings.post': api.bind,
    }),
  }
})
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: api.installedRequest,
}))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  getUserCanAccess: api.access,
}))
const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

let mockWebappAuthEnabled = false
let mockRbacEnabled = true
const mockConsoleState = {
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: ['app.create_and_management'] as string[],
}
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    accountProfile: mockConsoleState.userProfile,
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
    systemFeatures: {
      webapp_auth: { enabled: mockWebappAuthEnabled },
      rbac_enabled: mockRbacEnabled,
    },
  })
const getOperationsTrigger = () =>
  screen.getByRole('button', { name: /common\.operation\.moreActionsFor/ })
async function chooseAction(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(getOperationsTrigger())
  await user.click(await screen.findByRole('menuitem', { name }))
}
const popup: {
  location: { href: string }
  opener: Window | null
  close: ReturnType<typeof vi.fn>
} = {
  location: { href: '' },
  opener: null,
  close: vi.fn(),
}
const openWindow = vi.fn<() => typeof popup | null>()
const secret: EnvironmentVariableItemResponse = {
  id: 'secret-id',
  name: 'API_KEY',
  value: 'secret',
  value_type: 'secret',
  type: 'env',
  selector: ['env', 'API_KEY'],
  editable: true,
  edited: false,
  visible: true,
}
let installedApps: InstalledAppListResponse
const createMockApp = (overrides: Partial<AppPartial> = {}): AppPartial => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test app description',
  mode: 'chat',
  icon: '🤖',
  icon_type: 'emoji' as const,
  icon_background: '#FFEAD5',
  icon_url: null,
  author_name: 'Test Author',
  created_by: 'user-1',
  maintainer: 'user-1',
  created_at: 1704067200,
  updated_at: 1704153600,
  tags: [],
  use_icon_as_answer_icon: false,
  max_active_requests: null,
  access_mode: AccessMode.PUBLIC,
  has_draft_trigger: false,
  permission_keys: [],
  ...overrides,
})

describe('AppCard', () => {
  const mockApp = createMockApp()
  beforeEach(() => {
    vi.spyOn(toast, 'error')
    vi.spyOn(toast, 'warning')
    openWindow.mockReset().mockReturnValue(popup)
    popup.location.href = ''
    popup.opener = window
    vi.stubGlobal('open', openWindow)
    installedApps = {
      has_more: false,
      next_cursor: null,
      installed_apps: ['installed-1', 'installed-2'].map((id) => ({
        id,
        app_owner_tenant_id: 'workspace-1',
        editable: false,
        is_pinned: false,
        last_used_at: null,
        app: {
          id: mockApp.id,
          name: mockApp.name,
          description: '',
          mode: 'chat',
          icon: null,
          icon_type: null,
          icon_background: null,
          icon_url: null,
          use_icon_as_answer_icon: false,
        },
      })),
    }
    api.installedRequest.mockReset().mockResolvedValue(Response.json(installedApps))
    api.copy
      .mockReset()
      .mockResolvedValue(createAppDetailFixture({ id: 'new-app-id', maintainer: 'user-1' }))
    api.update.mockReset().mockResolvedValue(createAppDetailFixture())
    api.delete.mockReset().mockResolvedValue(undefined)
    api.star.mockReset().mockResolvedValue({ result: 'success' })
    api.unstar.mockReset().mockResolvedValue({ result: 'success' })
    api.convert
      .mockReset()
      .mockResolvedValue({ new_app_id: 'converted-app', permission_keys: [AppACLPermission.Edit] })
    api.export.mockReset().mockResolvedValue({ data: 'kind: app' })
    api.env.mockReset().mockResolvedValue({ items: [] })
    api.tags.mockReset().mockResolvedValue([{ id: 'tag1', name: 'Tag 1', type: 'app' }])
    api.bind.mockReset().mockResolvedValue({ result: 'success' })
    api.access.mockReset().mockResolvedValue({ result: true })
    mockWebappAuthEnabled = false
    mockRbacEnabled = true
    mockConsoleState.userProfile = { id: 'user-1' }
    mockConsoleState.workspacePermissionKeys = ['app.create_and_management']
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('should render preview-only app card as an information-only card that explains the permission restriction', async () => {
    const user = userEvent.setup()
    const previewOnlyApp = createMockApp({
      name: 'Preview Only App',
      description: 'Only visible metadata',
      author_name: 'Readonly Author',
      created_by: 'another-user',
      maintainer: 'another-user',
      tags: [{ id: 'tag-preview', name: 'Readonly Tag', type: 'app' as const }],
      permission_keys: [AppACLPermission.Preview],
    })

    render(<AppCard app={previewOnlyApp} />)

    const card = screen.getByRole('button', { name: 'Preview Only App' })
    expect(screen.getByRole('listitem')).toContainElement(card)
    expect(card).toHaveAccessibleDescription('Only visible metadata')
    expect(card).not.toHaveAttribute('aria-disabled')
    expect(screen.getByText('Only visible metadata')).toBeInTheDocument()
    expect(screen.getByText('Readonly Author')).toBeInTheDocument()
    const tagSelector = screen.getByRole('combobox')
    expect(tagSelector).toBeInTheDocument()
    expect(tagSelector).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Preview Only App' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /app\.studio\.starApp/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /common\.operation\.moreActionsFor/,
      }),
    ).not.toBeInTheDocument()

    await user.click(tagSelector)

    expect(toast.warning).not.toHaveBeenCalled()

    await user.click(card)

    expect(toast.warning).toHaveBeenCalledWith('app.noAccessResourcePermission')
  })

  it('should render preview-only starred app card as an information-only card that explains the permission restriction', async () => {
    const user = userEvent.setup()
    const previewOnlyApp = createMockApp({
      name: 'Preview Only Starred App',
      author_name: 'Readonly Author',
      created_by: 'another-user',
      maintainer: 'another-user',
      permission_keys: [AppACLPermission.Preview],
    })

    render(<StarredAppCard app={previewOnlyApp} />)

    const card = screen.getByRole('button', { name: 'Preview Only Starred App' })
    expect(card).not.toHaveAttribute('aria-disabled')
    expect(screen.getByText('Readonly Author')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Preview Only Starred App' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /app\.studio\.starApp/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /common\.operation\.moreActionsFor/,
      }),
    ).not.toBeInTheDocument()

    await user.click(card)

    expect(toast.warning).toHaveBeenCalledWith('app.noAccessResourcePermission')
  })

  it('should render card navigation as a link', () => {
    render(<AppCard app={mockApp} />)
    const cardLink = screen.getByRole('link', { name: 'Test App' })

    expect(cardLink).toHaveAttribute('href', '/app/test-app-id/configuration')
    expect(cardLink).toHaveAccessibleName('Test App')
    expect(cardLink).toHaveAccessibleDescription('Test app description')
    expect(cardLink).toHaveAttribute('aria-describedby')
    expect(screen.getByRole('listitem')).toContainElement(cardLink)
    expect(screen.getByText('Test Author')).toBeInTheDocument()
  })

  it('should star the app from the card action', async () => {
    const user = userEvent.setup()
    render(<AppCard app={mockApp} />)

    const starToggle = screen.getByRole('button', { name: 'app.studio.starApp: Test App' })
    expect(starToggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(starToggle)

    await waitFor(() => {
      expect(api.star).toHaveBeenCalledWith({
        params: { app_id: mockApp.id },
      })
    })
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('should unstar the app from the filled star action', async () => {
    const user = userEvent.setup()
    const starredApp = createMockApp({ is_starred: true })
    render(<AppCard app={starredApp} />)

    const starToggle = screen.getByRole('button', { name: 'app.studio.starApp: Test App' })
    expect(starToggle).toHaveAttribute('aria-pressed', 'true')

    await user.hover(starToggle)

    expect(await screen.findByText('app.studio.starApp')).toBeInTheDocument()

    await user.click(starToggle)

    await waitFor(() => {
      expect(api.unstar).toHaveBeenCalledWith({
        params: { app_id: starredApp.id },
      })
    })
  })

  it('should expose the same operations from the card context menu', async () => {
    const user = userEvent.setup()
    render(<AppCard app={mockApp} />)

    await user.pointer({
      target: screen.getByRole('link', { name: 'Test App' }),
      keys: '[MouseRight]',
    })

    expect(await screen.findByRole('menuitem', { name: 'app.editApp' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'app.duplicate' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'app.exportApp' })).toBeInTheDocument()
  })

  it('should keep card actions outside the card context menu trigger', async () => {
    const user = userEvent.setup()
    render(<AppCard app={mockApp} />)

    await user.pointer({
      target: screen.getByRole('button', { name: 'app.studio.starApp: Test App' }),
      keys: '[MouseRight]',
    })

    expect(screen.queryByRole('menuitem', { name: 'app.editApp' })).not.toBeInTheDocument()
  })

  it('should show duplicate option when user can create apps without app import export permission', async () => {
    const user = userEvent.setup()
    const appWithoutImportExportPermission = createMockApp({
      created_by: 'another-user',
      maintainer: 'another-user',
      permission_keys: [AppACLPermission.ViewLayout],
    })
    render(<AppCard app={appWithoutImportExportPermission} />)

    await user.click(getOperationsTrigger())

    await waitFor(() => {
      expect(screen.getByText('app.duplicate')).toBeInTheDocument()
    })
    expect(screen.queryByText('app.exportApp')).not.toBeInTheDocument()
  })

  it('should show duplicate option on starred cards when user can create apps without app import export permission', async () => {
    const user = userEvent.setup()
    const appWithoutImportExportPermission = createMockApp({
      created_by: 'another-user',
      maintainer: 'another-user',
      permission_keys: [AppACLPermission.ViewLayout],
    })
    render(<StarredAppCard app={appWithoutImportExportPermission} />)

    await user.click(getOperationsTrigger())

    await waitFor(() => {
      expect(screen.getByText('app.duplicate')).toBeInTheDocument()
    })
    expect(screen.queryByText('app.exportApp')).not.toBeInTheDocument()
  })

  it('should hide duplicate but keep app-authorized switch without app creation permission', async () => {
    const user = userEvent.setup()
    mockConsoleState.workspacePermissionKeys = []
    const editableChatApp = createMockApp({
      created_by: 'another-user',
      maintainer: 'another-user',
      mode: 'chat',
      permission_keys: [AppACLPermission.Edit],
    })
    render(<AppCard app={editableChatApp} />)

    await user.click(getOperationsTrigger())

    await waitFor(() => {
      expect(screen.getByText(/switch/i)).toBeInTheDocument()
    })
    expect(screen.queryByText('app.duplicate')).not.toBeInTheDocument()
  })

  it('should not show switch option for workflow mode apps', async () => {
    const user = userEvent.setup()
    const workflowApp = { ...mockApp, mode: 'workflow' as const }
    render(<AppCard app={workflowApp} />)

    await user.click(getOperationsTrigger())

    await waitFor(() => {
      expect(screen.queryByText(/switch/i)).not.toBeInTheDocument()
    })
  })

  it('should clear delete confirmation input after closing the dialog', async () => {
    const user = userEvent.setup()
    render(<AppCard app={mockApp} />)

    await chooseAction(user, 'common.operation.delete')

    const deleteInput = await screen.findByRole('textbox')
    await user.type(deleteInput, 'partial name')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    await chooseAction(user, 'common.operation.delete')

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('')
    })
  })

  it('should handle delete failure', async () => {
    const user = userEvent.setup()
    api.delete.mockRejectedValueOnce(new Error('Delete failed'))

    render(<AppCard app={mockApp} />)

    await chooseAction(user, 'common.operation.delete')
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

    const deleteInput = screen.getByRole('textbox')
    await user.type(deleteInput, mockApp.name)

    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith({ params: { app_id: mockApp.id } })
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Delete failed'))
    })
    expect(screen.getByRole('textbox')).toHaveValue(mockApp.name)
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(api.delete).toHaveBeenCalledTimes(2)
  })

  it('should hide open in explore for SSO-restricted apps', async () => {
    mockWebappAuthEnabled = true
    mockWebappAuthEnabled = true
    const user = userEvent.setup()
    const ssoApp = createMockApp({ access_mode: AccessMode.EXTERNAL_MEMBERS })

    render(<AppCard app={ssoApp} />)

    await user.click(getOperationsTrigger())
    const menu = await screen.findByRole('menu')

    expect(
      within(menu).queryByRole('menuitem', { name: 'app.openInExplore' }),
    ).not.toBeInTheDocument()
  })

  it('opens the popup before lookup completes and navigates to the first installed app', async () => {
    const user = userEvent.setup()
    let resolveResponse!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    api.installedRequest.mockReturnValueOnce(response)
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'app.openInExplore')

    expect(openWindow).toHaveBeenCalledOnce()
    expect(openWindow).toHaveBeenCalledWith('about:blank', '_blank', undefined)
    expect(popup.opener).toBeNull()
    expect(popup.location.href).toBe('')
    await waitFor(() => expect(api.installedRequest).toHaveBeenCalledOnce())
    const url = new URL(api.installedRequest.mock.calls[0]![0])
    expect(url.pathname).toBe('/console/api/installed-apps')
    expect(url.searchParams.get('app_id')).toBe(mockApp.id)
    expect(api.installedRequest.mock.calls[0]![2].request.method).toBe('GET')
    resolveResponse(Response.json(installedApps))
    await waitFor(() => expect(popup.location.href).toBe('/installed/installed-1'))
    expect(popup.close).not.toHaveBeenCalled()
  })

  it('reports a blocked popup without making a request', async () => {
    const user = userEvent.setup()
    openWindow.mockReturnValueOnce(null)
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'app.openInExplore')
    expect(api.installedRequest).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Failed to open new window')
  })

  it('should render the tour-controlled operations menu as presentation only', async () => {
    render(
      <AppCard
        app={mockApp}
        stepByStepTourActionMenuHighlightPart={
          STEP_BY_STEP_TOUR_TARGETS.studioWithAppsFirstAppCardActionsMenu
        }
        stepByStepTourActionMenuOpen
      />,
    )

    expect(await screen.findByText('app.editApp')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'app.editApp', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
  })

  it('should tell workflow users to publish before opening in explore', async () => {
    const user = userEvent.setup()
    const workflowApp = createMockApp({
      mode: 'workflow' as const,
      workflow: undefined,
    })
    render(<AppCard app={workflowApp} />)

    await user.click(getOperationsTrigger())
    await waitFor(() => {
      expect(screen.getByText('app.openInExplore')).toBeInTheDocument()
    })

    await user.click(screen.getByText('app.openInExplore'))

    expect(openWindow).not.toHaveBeenCalled()
    expect(api.installedRequest).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('app.notPublishedYet')
  })

  it('closes the popup and reports an empty installed list', async () => {
    const user = userEvent.setup()
    api.installedRequest.mockResolvedValueOnce(
      Response.json({ has_more: false, installed_apps: [], next_cursor: null }),
    )
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'app.openInExplore')
    await waitFor(() => expect(popup.close).toHaveBeenCalledOnce())
    expect(popup.location.href).toBe('')
    expect(toast.error).toHaveBeenCalledWith('app.notPublishedYet')
  })

  it('closes the popup and reports a failed lookup without retrying', async () => {
    const user = userEvent.setup()
    api.installedRequest.mockRejectedValueOnce(new Error('Network error'))
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'app.openInExplore')
    await waitFor(() => expect(popup.close).toHaveBeenCalledOnce())
    expect(api.installedRequest).toHaveBeenCalledOnce()
    expect(popup.location.href).toBe('')
    expect(toast.error).toHaveBeenCalledWith('Network error')
  })

  it('should not show open in explore option for apps with has_draft_trigger', async () => {
    const user = userEvent.setup()
    const draftTriggerApp = createMockApp({ has_draft_trigger: true })
    render(<AppCard app={draftTriggerApp} />)

    await user.click(getOperationsTrigger())
    await waitFor(() => {
      expect(screen.getByText('app.editApp')).toBeInTheDocument()

      expect(screen.queryByText('app.openInExplore')).not.toBeInTheDocument()
    })
  })

  it('should show resource access option when user only has app access config permission', async () => {
    mockWebappAuthEnabled = true
    const user = userEvent.setup()
    const appWithAccessConfigPermission = createMockApp({
      created_by: 'another-user',
      maintainer: 'another-user',
      permission_keys: [AppACLPermission.AccessConfig, AppACLPermission.Delete],
    })
    render(<AppCard app={appWithAccessConfigPermission} />)

    await user.click(getOperationsTrigger())

    await waitFor(() => {
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })
    expect(screen.queryByText('app.accessControl')).not.toBeInTheDocument()
    expect(screen.getByText('navigation.settings.resourceAccess')).toBeInTheDocument()
  })

  it('should hide resource access option when RBAC is disabled', async () => {
    mockWebappAuthEnabled = true
    const user = userEvent.setup()
    mockRbacEnabled = false
    const appWithAccessConfigPermission = createMockApp({
      created_by: 'another-user',
      maintainer: 'another-user',
      permission_keys: [AppACLPermission.AccessConfig, AppACLPermission.Delete],
    })
    render(<AppCard app={appWithAccessConfigPermission} />)

    await user.click(getOperationsTrigger())

    await waitFor(() => {
      expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
    })
    expect(screen.queryByText('navigation.settings.resourceAccess')).not.toBeInTheDocument()
  })

  it('should navigate to app access config when resource access is clicked', async () => {
    mockWebappAuthEnabled = true
    const user = userEvent.setup()
    const appWithAccessConfigPermission = createMockApp({
      created_by: 'another-user',
      maintainer: 'another-user',
      permission_keys: [AppACLPermission.AccessConfig],
    })
    render(<AppCard app={appWithAccessConfigPermission} />)

    await user.click(getOperationsTrigger())
    await user.click(await screen.findByText('navigation.settings.resourceAccess'))

    expect(mockPush).toHaveBeenCalledWith('/app/test-app-id/access-config')
  })

  it.each([
    { permissions: [AppACLPermission.Edit], workspace: [], allowed: true },
    { permissions: [AppACLPermission.ViewLayout], workspace: ['app.tag.manage'], allowed: true },
    { permissions: [AppACLPermission.ViewLayout], workspace: [], allowed: false },
  ])(
    'binds tags only with app edit or workspace tag permission: %j',
    async ({ permissions, workspace, allowed }) => {
      const user = userEvent.setup()
      mockConsoleState.workspacePermissionKeys = workspace
      render(
        <AppCard
          app={createMockApp({ maintainer: 'another-user', permission_keys: permissions })}
        />,
      )
      const trigger = screen.getByRole('combobox')
      if (!allowed) {
        expect(trigger).toBeDisabled()
        await user.click(trigger)
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(api.bind).not.toHaveBeenCalled()
        return
      }
      await user.click(trigger)
      await user.click(await screen.findByRole('option', { name: 'Tag 1' }))
      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(api.bind).toHaveBeenCalledWith({
          body: { tag_ids: ['tag1'], target_id: 'test-app-id', type: 'app' },
        }),
      )
      expect(mockPush).not.toHaveBeenCalled()
    },
  )

  it('refreshes selected tag names from the shared tag query', async () => {
    const app = createMockApp({ tags: [{ id: 'tag1', name: 'Tag 1', type: 'app' }] })
    const { queryClient } = render(<AppCard app={app} />)
    expect(await screen.findByRole('combobox', { name: 'Tag 1: Test App' })).toBeInTheDocument()
    act(() =>
      queryClient.setQueryData(
        consoleQuery.tags.get.queryKey({ input: { query: { type: 'app' } } }),
        [{ id: 'tag1', name: 'Renamed tag', type: 'app' }],
      ),
    )
    expect(
      await screen.findByRole('combobox', { name: 'Renamed tag: Test App' }),
    ).toBeInTheDocument()
  })

  it('requires an exact app name and supports filling it before delete', async () => {
    const user = userEvent.setup()
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'common.operation.delete')
    const input = await screen.findByRole('textbox')
    await user.type(input, 'Test')
    expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(api.delete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.fill' }))
    expect(input).toHaveValue(mockApp.name)
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(api.delete).toHaveBeenCalledOnce()
    expect(api.delete).toHaveBeenCalledWith({ params: { app_id: mockApp.id } })
  })

  it('keeps the failed edit draft and retries without reopening the card dialog', async () => {
    const user = userEvent.setup()
    api.update.mockRejectedValueOnce(new Error('Edit failed'))
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'app.editApp')
    const dialog = await screen.findByRole('dialog', { name: 'app.editAppTitle' })
    const name = within(dialog).getByRole('textbox', { name: 'app.newApp.name' })
    const description = within(dialog).getByRole('textbox', {
      name: 'app.newApp.captionDescription',
    })
    await waitFor(() => expect(name).toHaveFocus())
    await user.clear(name)
    await user.type(name, 'Updated App')
    await user.clear(description)
    await user.type(description, 'Updated description')
    await user.click(within(dialog).getByRole('button', { name: /common.operation.save/ }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Edit failed')
    expect(name).toHaveValue('Updated App')
    expect(description).toHaveValue('Updated description')
    expect(toast.error).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /common.operation.save/ }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(api.update).toHaveBeenCalledTimes(2)
    expect(api.update).toHaveBeenLastCalledWith({
      params: { app_id: mockApp.id },
      body: {
        name: 'Updated App',
        description: 'Updated description',
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#FFEAD5',
        use_icon_as_answer_icon: false,
      },
    })
  })

  it.each([
    {
      action: 'app.editApp',
      title: 'app.editAppTitle',
      initial: 'Test App',
    },
    {
      action: 'app.duplicate',
      title: 'app.duplicateTitle',
      initial: 'Test App',
    },
  ])(
    'discards unsubmitted name changes when reopening $action',
    async ({ action, title, initial }) => {
      const user = userEvent.setup()
      render(<AppCard app={mockApp} />)
      await chooseAction(user, action)
      const dialog = await screen.findByRole('dialog', { name: title })
      const input = within(dialog).getByRole('textbox', { name: 'app.newApp.name' })
      await user.clear(input)
      await user.type(input, 'Unsaved name')
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      await chooseAction(user, action)
      expect(await screen.findByRole('textbox', { name: 'app.newApp.name' })).toHaveValue(initial)
      expect(api.update).not.toHaveBeenCalled()
      expect(api.copy).not.toHaveBeenCalled()
    },
  )

  it('duplicates the chosen name and source icon, then navigates to the new app', async () => {
    const user = userEvent.setup()
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'app.duplicate')
    const dialog = await screen.findByRole('dialog', { name: 'app.duplicateTitle' })
    const name = within(dialog).getByRole('textbox', { name: 'app.newApp.name' })
    await user.clear(name)
    await user.type(name, 'Copied App')
    await user.click(within(dialog).getByRole('button', { name: 'app.duplicate' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/app/new-app-id/configuration'))
    expect(api.copy).toHaveBeenCalledWith({
      params: { app_id: mockApp.id },
      body: { name: 'Copied App', icon_type: 'emoji', icon: '🤖', icon_background: '#FFEAD5' },
    })
    expect(dialog).not.toBeInTheDocument()
  })

  it('reports failed duplication without navigating to a new app', async () => {
    const user = userEvent.setup()
    api.copy.mockRejectedValueOnce(new Error('Copy failed'))
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'app.duplicate')
    const dialog = await screen.findByRole('dialog', { name: 'app.duplicateTitle' })
    await user.click(within(dialog).getByRole('button', { name: 'app.duplicate' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('app.newApp.appCreateFailed'))
    expect(mockPush).not.toHaveBeenCalled()
  })

  it.each(['chat', 'completion'] as const)(
    'converts a %s app from the card and opens its workflow',
    async (mode) => {
      const user = userEvent.setup()
      render(<AppCard app={createMockApp({ mode })} />)
      await chooseAction(user, 'app.switch')
      const dialog = await screen.findByRole('dialog', { name: 'app.switch' })
      const name = within(dialog).getByRole('textbox', { name: 'app.newApp.name' })
      await user.clear(name)
      await user.type(name, 'Converted App')
      await user.click(within(dialog).getByRole('button', { name: 'app.switchStart' }))
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/app/converted-app/workflow'))
      expect(api.convert).toHaveBeenCalledWith({
        params: { app_id: mockApp.id },
        body: { name: 'Converted App', icon_type: 'emoji', icon: '🤖', icon_background: '#FFEAD5' },
      })
      expect(api.delete).not.toHaveBeenCalled()
      expect(dialog).not.toBeInTheDocument()
    },
  )

  it.each(['chat', 'workflow', 'advanced-chat'] as const)(
    'downloads the %s DSL and checks environment variables only for workflow modes',
    async (mode) => {
      const user = userEvent.setup()
      const downloads = captureDownloads()
      render(<AppCard app={createMockApp({ mode })} />)
      await chooseAction(user, 'app.exportApp')
      await waitFor(() => expect(downloads).toHaveLength(1))
      expect(downloads[0]!.filename).toBe('Test App.yml')
      expect(await downloads[0]!.blob.text()).toBe('kind: app')
      expect(api.export).toHaveBeenCalledWith({
        params: { app_id: mockApp.id },
        query: { include_secret: false },
      })
      if (mode === 'chat') expect(api.env).not.toHaveBeenCalled()
      else expect(api.env).toHaveBeenCalledWith({ params: { app_id: mockApp.id } })
    },
  )

  it('prevents duplicate exports while keeping other menu actions available', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<{ data: string }>()
    api.export.mockReturnValueOnce(pending.promise)
    const downloads = captureDownloads()
    render(<AppCard app={mockApp} />)
    await chooseAction(user, 'app.exportApp')
    await waitFor(() => expect(api.export).toHaveBeenCalledOnce())
    await user.click(getOperationsTrigger())
    const item = await screen.findByRole('menuitem', { name: 'app.exportApp' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'app.editApp' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(item)
    expect(api.export).toHaveBeenCalledOnce()
    pending.resolve({ data: 'kind: app' })
    await waitFor(() => expect(downloads).toHaveLength(1))
    await waitFor(() => expect(item).not.toHaveAttribute('aria-disabled', 'true'))
  })

  it.each([false, true])(
    'exports workflow secrets only with explicit consent: %s',
    async (includeSecret) => {
      const user = userEvent.setup()
      api.env.mockResolvedValue({
        items: [secret],
      })
      const downloads = captureDownloads()
      render(<AppCard app={createMockApp({ mode: 'workflow' })} />)
      await chooseAction(user, 'app.exportApp')
      const dialog = await screen.findByRole('alertdialog', { name: 'app.exportSecret.title' })
      expect(within(dialog).getByText('API_KEY')).toBeInTheDocument()
      expect(api.export).not.toHaveBeenCalled()
      const checkbox = within(dialog).getByRole('checkbox', {
        name: 'workflow.env.export.checkbox',
      })
      expect(checkbox).not.toBeChecked()
      if (includeSecret) await user.click(checkbox)
      await user.click(
        within(dialog).getByRole('button', {
          name: includeSecret ? 'app.exportSecret.title' : 'app.exportApp',
        }),
      )
      await waitFor(() => expect(downloads).toHaveLength(1))
      expect(api.export).toHaveBeenCalledWith({
        params: { app_id: mockApp.id },
        query: { include_secret: includeSecret },
      })
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
    },
  )

  it('clears secret export consent when the warning is cancelled and reopened', async () => {
    const user = userEvent.setup()
    api.env.mockResolvedValue({
      items: [secret],
    })
    render(<AppCard app={createMockApp({ mode: 'workflow' })} />)
    await chooseAction(user, 'app.exportApp')
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await chooseAction(user, 'app.exportApp')
    expect(await screen.findByRole('checkbox')).not.toBeChecked()
    expect(api.export).not.toHaveBeenCalled()
  })

  it.each([true, false])('waits for webapp access before exposing Explore: %s', async (result) => {
    const user = userEvent.setup()
    const pending = createDeferred<{ result: boolean }>()
    mockWebappAuthEnabled = true
    api.access.mockReturnValue(pending.promise)
    render(<AppCard app={mockApp} />)
    await user.click(getOperationsTrigger())
    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: 'app.openInExplore' })).not.toBeInTheDocument()
    await waitFor(() => expect(api.access).toHaveBeenCalledWith(mockApp.id, true))
    await act(async () => pending.resolve({ result }))
    if (result)
      expect(await screen.findByRole('menuitem', { name: 'app.openInExplore' })).toBeInTheDocument()
    else
      expect(screen.queryByRole('menuitem', { name: 'app.openInExplore' })).not.toBeInTheDocument()
  })

  it('shows the publish requirement for a workflow even while webapp access is pending', async () => {
    const user = userEvent.setup()
    mockWebappAuthEnabled = true
    api.access.mockImplementation(() => new Promise(() => {}))
    render(<AppCard app={createMockApp({ mode: 'workflow' })} />)
    await chooseAction(user, 'app.openInExplore')
    expect(toast.error).toHaveBeenCalledWith('app.notPublishedYet')
    expect(openWindow).not.toHaveBeenCalled()
    expect(api.installedRequest).not.toHaveBeenCalled()
  })
})
