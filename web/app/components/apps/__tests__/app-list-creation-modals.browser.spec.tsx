import type { GetExploreAppsResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { AppListCreationDialog } from '../app-list-creation-modals'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { CreateAppDropdown } from '@/app/components/app/create-app-dropdown'
import { emojiCatalogOptions } from '@/app/components/base/icon-picker/emoji-data'
import { RosterCreateMenu } from '@/features/agent-v2/roster/components/roster-create-menu'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { AppListCreationModals } from '../app-list-creation-modals'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}))

const catalog: GetExploreAppsResponse = {
  recommended_apps: [
    {
      app_id: 'template-alpha',
      app: {
        id: 'source-alpha',
        name: 'Alpha',
        mode: 'chat',
        icon_type: 'emoji',
        icon: '🙂',
        icon_background: '#fff',
        icon_url: null,
      },
      can_trial: false,
      categories: ['Assistant'],
      description: 'Alpha description',
      position: 0,
    },
  ],
  categories: ['Assistant'],
}
const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []

function CreationOwner() {
  const [dialog, setDialog] = useState<AppListCreationDialog>(null)
  const openBlank = () => setDialog({ type: 'blank' })
  const openTemplate = () => setDialog({ type: 'template' })
  return (
    <>
      <CreateAppDropdown
        onCreateBlank={openBlank}
        onCreateTemplate={openTemplate}
        onImportDSL={() => setDialog({ type: 'dsl' })}
      />
      <AppListCreationModals
        canCreateApp
        category="all"
        dialog={dialog}
        onClose={() => setDialog(null)}
        onOpenBlank={openBlank}
        onOpenTemplate={openTemplate}
      />
    </>
  )
}

async function renderOwner() {
  const { queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['app.create_and_management'],
  })
  clients.push(queryClient)
  queryClient.setQueryData(
    consoleQuery.explore.apps.get.queryKey({ input: { query: { language: 'en-US' } } }),
    catalog,
  )
  queryClient.setQueryData(emojiCatalogOptions.queryKey, [])
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <CreationOwner />
    </QueryClientTestProvider>,
  )
}

beforeEach(async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  await page.viewport(1440, 1000)
  transport.mockReset()
  transport.mockImplementation(async (path: string[]) => {
    throw new Error(`Unexpected request: ${path.join('.')}`)
  })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it('keeps the blank draft through exit and reopens fresh from the real creation menu', async () => {
  const screen = await renderOwner()
  const entry = screen.getByRole('button', { name: 'common.operation.create', exact: true })
  await entry.click()
  await screen.getByRole('menuitem', { name: 'app.newApp.startFromBlank' }).click()
  const dialog = page.getByRole('dialog', { name: 'app.newApp.startFromBlank', exact: true })
  const name = dialog.getByRole('textbox', { name: 'app.newApp.captionName', exact: true })
  await name.fill('Exit draft')
  const popup = dialog.element()
  await expect
    .poll(
      () =>
        !popup.hasAttribute('data-starting-style') &&
        popup.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  const exitDrafts: string[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style'))
      exitDrafts.push((name.element() as HTMLInputElement).value)
  })
  await dialog.getByRole('button', { name: 'app.newApp.Cancel', exact: true }).click()
  await expect.poll(() => exitDrafts.length).toBeGreaterThan(0)
  expect(exitDrafts.every((value) => value === 'Exit draft')).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await screen.getByRole('menuitem', { name: 'app.newApp.startFromBlank' }).click()
  await expect
    .element(page.getByRole('textbox', { name: 'app.newApp.captionName', exact: true }))
    .toHaveValue('')
})

it('hands focus between blank and template windows and cancels naming without closing the catalog', async () => {
  const screen = await renderOwner()
  const entry = screen.getByRole('button', { name: 'common.operation.create', exact: true })
  await entry.click()
  await screen.getByRole('menuitem', { name: 'app.newApp.startFromBlank' }).click()
  const blank = page.getByRole('dialog', { name: 'app.newApp.startFromBlank', exact: true })
  await blank
    .getByRole('textbox', { name: 'app.newApp.captionName', exact: true })
    .fill('Old blank draft')
  const oldBlank = blank.element()
  await blank.getByRole('button', { name: 'app.newApp.noIdeaTip' }).click()
  const templates = page.getByRole('dialog', { name: 'app.newApp.startFromTemplate', exact: true })
  await expect.element(templates.getByRole('searchbox')).toBeVisible()
  await expect.poll(() => oldBlank.isConnected).toBe(false)
  await expect.poll(() => templates.element().contains(document.activeElement)).toBe(true)
  const useTemplate = templates.getByRole('button', { name: 'app.newApp.useTemplate Alpha' })
  await templates.getByText('Alpha', { exact: true }).hover()
  await useTemplate.click()
  const naming = page.getByRole('dialog', { name: /^explore.appCustomize.title/ })
  await naming
    .getByRole('textbox', { name: 'app.newApp.captionName' })
    .fill('Discarded template name')
  const namingPopup = naming.element()
  await naming.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => namingPopup.isConnected).toBe(false)
  await expect.element(templates).toBeVisible()
  await expect.element(useTemplate).toHaveFocus()
  expect(transport).not.toHaveBeenCalled()

  const oldTemplates = templates.element()
  await templates.getByRole('button', { name: 'app.newApp.startFromBlank', exact: true }).click()
  await expect.element(blank).toBeVisible()
  await expect.poll(() => oldTemplates.isConnected).toBe(false)
  await expect.poll(() => blank.element().contains(document.activeElement)).toBe(true)
  await expect
    .element(blank.getByRole('textbox', { name: 'app.newApp.captionName', exact: true }))
    .toHaveValue('')
  await blank.getByRole('button', { name: 'app.newApp.Cancel', exact: true }).click()
  await expect.element(blank).not.toBeInTheDocument()
  await expect.element(entry).toHaveFocus()
})

it('retains the template search through exit and reopens the complete catalog', async () => {
  const screen = await renderOwner()
  const entry = screen.getByRole('button', { name: 'common.operation.create', exact: true })
  await entry.click()
  await screen.getByRole('menuitem', { name: 'app.newApp.startFromTemplate' }).click()
  const dialog = page.getByRole('dialog', { name: 'app.newApp.startFromTemplate', exact: true })
  const search = dialog.getByRole('searchbox')
  await search.fill('Alpha')
  const input = search.element() as HTMLInputElement
  const popup = dialog.element()
  const exitSearches: string[] = []
  await expect
    .poll(
      () =>
        !popup.hasAttribute('data-starting-style') &&
        popup.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exitSearches.push(input.value)
  })
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => exitSearches.length).toBeGreaterThan(0)
  expect(exitSearches.every((value) => value === 'Alpha')).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await screen.getByRole('menuitem', { name: 'app.newApp.startFromTemplate' }).click()
  await expect.element(dialog.getByRole('searchbox')).toHaveValue('')
  await expect.element(dialog.getByRole('button', { name: 'Assistant', exact: true })).toBeVisible()
})

it('keeps the roster Agent catalog through exit and returns focus to its actual menu', async () => {
  const { queryClient } = createConsoleQueryWrapper()
  clients.push(queryClient)
  queryClient.setQueryData(consoleQuery.workspaces.current.rbac.myPermissions.get.queryKey(), {
    ...seedWorkspacePermissionsQuery(queryClient, ['agent.create']),
    agent: { default_permission_keys: ['agent.acl.import_export_dsl'], overrides: [] },
  })
  queryClient.setQueryData(
    consoleQuery.explore.apps.get.queryKey({ input: { query: { language: 'en-US' } } }),
    {
      ...catalog,
      recommended_apps: [
        ...catalog.recommended_apps,
        {
          app_id: 'agent-template',
          can_trial: false,
          categories: ['Assistant'],
          description: 'Agent template description',
          position: 1,
          app: {
            id: 'agent-source',
            icon_type: 'emoji',
            icon: '🙂',
            icon_background: '#fff',
            icon_url: null,
            name: 'Agent template',
            mode: 'agent',
          },
        },
      ],
    },
  )
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <RosterCreateMenu />
    </QueryClientTestProvider>,
  )
  const entry = screen.getByRole('button', { name: 'common.operation.create', exact: true })
  await entry.click()
  await screen.getByRole('menuitem', { name: 'app.newApp.startFromTemplate' }).click()
  const dialog = page.getByRole('dialog', { name: 'app.newApp.startFromTemplate', exact: true })
  await expect.element(dialog.getByText('Agent template', { exact: true })).toBeVisible()
  await expect.element(dialog.getByText('Alpha', { exact: true })).not.toBeInTheDocument()
  const popup = dialog.element()
  const heading = dialog.getByText('Agent template', { exact: true }).element()
  await expect
    .poll(
      () =>
        !popup.hasAttribute('data-starting-style') &&
        popup.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  const exits: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exits.push(heading.isConnected)
  })
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.poll(() => exits.length).toBeGreaterThan(0)
  expect(exits.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)
})
