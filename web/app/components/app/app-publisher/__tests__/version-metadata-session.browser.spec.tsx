import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { VersionHistory } from '@/types/workflow'
import { QueryClient } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createHooksStore, HooksStoreContext } from '@/app/components/workflow/hooks-store'
import { VersionHistoryPanel } from '@/app/components/workflow/panel/version-history-panel'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { FlowType } from '@/types/common'
import { AppPublisher } from '../index'

const { get, patch, request } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/service/base', () => ({
  get,
  patch,
  request,
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postMarketplace: vi.fn(),
  postPublic: vi.fn(),
  delPublic: vi.fn(),
  patchPublic: vi.fn(),
  upload: vi.fn(),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
  sseGeneratorPost: vi.fn(),
  handleStream: vi.fn(),
  buildSigninUrlWithRedirect: vi.fn(),
  isWebAppSigninPath: vi.fn(),
  buildWebAppSigninUrlWithRedirect: vi.fn(),
}))
// Canvas restore/export behavior is independent of editing version metadata.
vi.mock('@/app/components/workflow/hooks/use-DSL', () => ({
  useDSL: () => ({ handleExportDSL: vi.fn() }),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({
    handleRestoreFromPublishedWorkflow: vi.fn(),
    handleLoadBackupDraft: vi.fn(),
  }),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow-refresh-draft', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: vi.fn() }),
}))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const version = (id: string, name: string): VersionHistory & WorkflowResponse => ({
  id,
  version: '2026-10-01T00:00:00Z',
  marked_name: name,
  marked_comment: `${name} notes`,
  graph: { nodes: [], edges: [] },
  created_at: 1_780_000_000,
  updated_at: 1_780_000_000,
  created_by: { id: 'user-1', name: 'Editor', email: 'editor@example.test' },
  updated_by: { id: 'user-1', name: 'Editor', email: 'editor@example.test' },
  features: {},
  conversation_variables: [],
  environment_variables: [],
  rag_pipeline_variables: [],
  hash: 'hash',
  tool_published: false,
})
const versions = [version('version-a', 'Release A'), version('version-b', 'Release B')]
const clients: QueryClient[] = []
async function setup(publisher = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { interface_language: 'en-US' })
  seedWorkspacePermissionsQuery(client, [])
  client.setQueryData(systemFeaturesQueryOptions().queryKey, createSystemFeaturesFixture())
  client.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({ id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT, permission_keys: [] }),
  )
  client.setQueryData(appWorkflowQueryOptions('app-1').queryKey, versions[0])
  get.mockResolvedValue({ items: versions, page: 1, has_more: false, limit: 10, total: 2 })
  request.mockImplementation(async () => Response.json(versions[0]))
  const workflowStore = createWorkflowStore({})
  const hooksStore = createHooksStore({
    configsMap: { flowId: 'app-1', flowType: FlowType.appFlow, fileSettings: {} },
  })
  return render(
    <NuqsTestingAdapter>
      <QueryClientTestProvider queryClient={client}>
        <WorkflowContext value={workflowStore}>
          <HooksStoreContext value={hooksStore}>
            {publisher ? (
              <AppPublisher appId="app-1" />
            ) : (
              <div style={{ height: 700 }}>
                <VersionHistoryPanel
                  appMode={AppModeEnum.ADVANCED_CHAT}
                  getVersionListUrl="/apps/app-1/workflows"
                  latestVersionId="version-a"
                  updateVersionUrl={(id) => `/apps/app-1/workflows/${id}`}
                  restoreVersionUrl={(id) => `/apps/app-1/workflows/${id}/restore`}
                />
              </div>
            )}
          </HooksStoreContext>
        </WorkflowContext>
      </QueryClientTestProvider>
    </NuqsTestingAdapter>,
  )
}
async function observeExit(element: Element, field: HTMLInputElement | HTMLTextAreaElement) {
  await expect
    .poll(
      () =>
        !element.hasAttribute('data-starting-style') &&
        element.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  const observed = { value: undefined as string | undefined }
  element.addEventListener('transitionrun', () => {
    if (element.hasAttribute('data-ending-style')) observed.value = field.value
  })
  return observed
}
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(1100, 900)
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
it('preserves history edits through exit and reopens another version from its own metadata', async () => {
  const screen = await setup()
  const more = screen.getByRole('button', { name: 'common.operation.more', exact: true }).first()
  await more.click()
  await screen
    .getByRole('menuitem', { name: 'workflowHistory.versionHistory.editVersionInfo' })
    .click()
  const dialog = screen.getByRole('dialog', {
    name: 'workflowHistory.versionHistory.editVersionInfo',
  })
  const title = dialog.getByRole('textbox', {
    name: 'workflowHistory.versionHistory.editField.title',
    exact: true,
  })
  await title.fill('Unsaved draft')
  const element = dialog.element()
  const exit = await observeExit(element, title.element() as HTMLInputElement)
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => exit.value).toBe('Unsaved draft')
  await expect.poll(() => element.isConnected).toBe(false)
  await expect.element(more).toHaveFocus()
  expect((more.element() as HTMLElement).checkVisibility({ opacityProperty: true })).toBe(true)
  await screen.getByRole('button', { name: 'common.operation.more', exact: true }).nth(1).click()
  await screen
    .getByRole('menuitem', { name: 'workflowHistory.versionHistory.editVersionInfo' })
    .click()
  await expect.element(title).toHaveValue('Release B')
  await expect
    .element(
      dialog.getByRole('textbox', {
        name: 'workflowHistory.versionHistory.editField.releaseNotes',
      }),
    )
    .toHaveValue('Release B notes')
})
it('hands the publisher popup to the editor and returns to Publish with fresh source values', async () => {
  const screen = await setup(true)
  const publish = screen.getByRole('button', { name: 'workflow.common.publish', exact: true })
  await publish.click()
  await screen
    .getByRole('button', { name: 'workflowHistory.versionHistory.editVersionInfo' })
    .click()
  const dialog = screen.getByRole('dialog', {
    name: 'workflowHistory.versionHistory.editVersionInfo',
  })
  const title = dialog.getByRole('textbox', {
    name: 'workflowHistory.versionHistory.editField.title',
    exact: true,
  })
  await title.fill('Publisher draft')
  const element = dialog.element()
  const exit = await observeExit(element, title.element() as HTMLInputElement)
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => exit.value).toBe('Publisher draft')
  await expect.poll(() => element.isConnected).toBe(false)
  await expect.element(publish).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await screen
    .getByRole('button', { name: 'workflowHistory.versionHistory.editVersionInfo' })
    .click()
  await expect.element(title).toHaveValue('Release A')
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(publish).toHaveFocus()
})
it('closes valid metadata immediately while the actual history PATCH is pending', async () => {
  let complete!: (value: VersionHistory) => void
  patch.mockReturnValue(
    new Promise<VersionHistory>((resolve) => {
      complete = resolve
    }),
  )
  const screen = await setup()
  const more = screen.getByRole('button', { name: 'common.operation.more', exact: true }).first()
  await more.click()
  await screen
    .getByRole('menuitem', { name: 'workflowHistory.versionHistory.editVersionInfo' })
    .click()
  const dialog = screen.getByRole('dialog', {
    name: 'workflowHistory.versionHistory.editVersionInfo',
  })
  const notes = dialog.getByRole('textbox', {
    name: 'workflowHistory.versionHistory.editField.releaseNotes',
  })
  await notes.fill('Updated notes')
  await notes.click()
  await userEvent.keyboard('{Enter}')
  expect(patch).not.toHaveBeenCalled()
  const element = dialog.element()
  const exit = await observeExit(element, notes.element() as HTMLTextAreaElement)
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.poll(() => exit.value).toBe('Updated notes\n')
  await expect.poll(() => element.isConnected).toBe(false)
  expect(patch).toHaveBeenCalledExactlyOnceWith('/apps/app-1/workflows/version-a', {
    body: { marked_name: 'Release A', marked_comment: 'Updated notes\n' },
  })
  await expect.element(more).toHaveFocus()
  complete({ ...versions[0]!, marked_comment: 'Updated notes\n' })
})
