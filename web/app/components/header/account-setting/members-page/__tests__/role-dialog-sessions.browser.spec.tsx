import type { Role } from '@/models/access-control'
import type { Member } from '@/models/common'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import MenuDialog from '../../menu-dialog'
import MembersPage from '../index'

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('#i18n', () => ({ useLocale: () => 'en-US' }))
vi.mock('@/service/base', () => ({
  get,
  post: vi.fn(),
  request: vi.fn(),
  getPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postPublic: vi.fn(),
  postMarketplace: vi.fn(),
  put,
  del: vi.fn(),
  delPublic: vi.fn(),
  patch: vi.fn(),
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

const reader: Role = {
  id: 'reader',
  tenant_id: 'workspace-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Reader',
  description: 'Read knowledge',
  is_builtin: false,
  permission_keys: [],
  role_tag: '',
}
const editor: Role = {
  ...reader,
  id: 'editor',
  name: 'Content editor',
  description: 'Edit knowledge',
}
const member: Member = {
  id: 'member-1',
  name: 'Alex Member',
  email: 'alex@example.com',
  avatar: '',
  avatar_url: '',
  role: 'normal',
  roles: [reader],
  last_active_at: '1731000000',
  last_login_at: '1731000000',
  created_at: '1731000000',
  status: 'active',
}
const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []
const closeSettings = vi.fn()
const detailsTitle = /workspaceMembers\.members\.memberDetails\.title/
const assignTitle = /workspaceMembers\.members\.assignRolesModal\.title/
const assignLabel = /workspaceMembers\.members\.memberDetails\.assign/

async function renderMembers() {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD', is_email_setup: true, rbac_enabled: true },
    workspacePermissionKeys: ['workspace.member.manage'],
    features: { members: { size: 1, limit: 10 } },
  })
  clients.push(queryClient)
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <MenuDialog title="Settings" onClose={closeSettings}>
          <MembersPage />
        </MenuDialog>
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
}

function observeExit(popup: Element, readDraft: () => boolean) {
  return new Promise<boolean>((resolve) => {
    const observe = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', observe)
      resolve(popup.isConnected && readDraft())
    }
    popup.addEventListener('transitionrun', observe)
  })
}

beforeEach(async () => {
  await page.viewport(1280, 900)
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  vi.clearAllMocks()
  get.mockImplementation(async (path: string) => {
    if (path === '/workspaces/current/members') return { accounts: [member] }
    if (path === '/workspaces/current/rbac/members/member-1/rbac-roles')
      return { account_id: member.id, roles: [reader] }
    if (path === '/workspaces/current/rbac/roles')
      return {
        data: [reader, editor],
        pagination: { total_count: 2, per_page: 20, current_page: 1, total_pages: 1 },
      }
    throw new Error(`Unexpected GET: ${path}`)
  })
  put.mockResolvedValue({ account_id: member.id, roles: [reader, editor] })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})

it('keeps nested role drafts through exit, closes only the chooser on Escape and discards canceled member changes', async () => {
  const screen = await renderMembers()
  const memberEntry = screen.getByRole('button', { name: member.name, exact: true })
  await memberEntry.click()
  const details = screen.getByRole('dialog', { name: detailsTitle, exact: true })
  const assignEntry = details.getByRole('button', { name: assignLabel, exact: true })
  await assignEntry.click()
  const chooser = screen.getByRole('dialog', { name: assignTitle, exact: true })
  const checkbox = chooser.getByRole('checkbox', { name: /Content editor/ })
  await checkbox.click()
  await chooser
    .getByRole('searchbox', { name: 'permission.role.searchPlaceholder' })
    .fill('Content')
  await userEvent.keyboard('{Enter}')
  await expect.element(chooser).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  await chooser.getByRole('heading', { name: assignTitle }).hover()
  const chooserPopup = chooser.element()
  const checkboxElement = checkbox.element()
  await expect.poll(() => getComputedStyle(chooserPopup).opacity).toBe('1')
  const chooserExit = observeExit(
    chooserPopup,
    () => checkboxElement.getAttribute('aria-checked') === 'true',
  )
  await userEvent.keyboard('{Escape}')
  expect(await chooserExit).toBe(true)
  await expect.element(chooser).not.toBeInTheDocument()
  await expect.element(details).toBeVisible()
  await expect.element(assignEntry).toHaveFocus()
  expect(closeSettings).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')
  await expect.element(checkbox).not.toBeChecked()
  await checkbox.click()
  await chooser.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(chooser).not.toBeInTheDocument()
  await expect.element(assignEntry).toHaveFocus()
  await expect
    .element(details.getByRole('button', { name: editor.name, exact: true }))
    .toBeVisible()
  expect(put).not.toHaveBeenCalled()
  const detailsPopup = details.element()
  const detailsExit = observeExit(
    detailsPopup,
    () =>
      detailsPopup.textContent?.includes(editor.name) === true &&
      detailsPopup.textContent.includes(member.email),
  )
  await details.getByRole('button', { name: 'common.operation.cancel' }).click()
  expect(await detailsExit).toBe(true)
  await expect.element(details).not.toBeInTheDocument()
  await expect.element(memberEntry).toHaveFocus()
  await expect
    .poll(() => memberEntry.element().checkVisibility({ opacityProperty: true }))
    .toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(details.getByRole('button', { name: reader.name, exact: true }))
    .toBeVisible()
  await expect
    .element(details.getByRole('button', { name: editor.name, exact: true }))
    .not.toBeInTheDocument()
  await details.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(details).not.toBeInTheDocument()
  await expect.element(memberEntry).toHaveFocus()
  expect(closeSettings).not.toHaveBeenCalled()
})

it('submits the MembersPage role owner once and closes details before the deferred update finishes', async () => {
  let finishUpdate!: () => void
  let settled = false
  put.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishUpdate = () => {
          settled = true
          resolve({ account_id: member.id, roles: [reader, editor] })
        }
      }),
  )
  const screen = await renderMembers()
  const memberEntry = screen.getByRole('button', { name: member.name, exact: true })
  await memberEntry.click()
  const details = screen.getByRole('dialog', { name: detailsTitle, exact: true })
  await details.getByRole('button', { name: assignLabel, exact: true }).click()
  const chooser = screen.getByRole('dialog', { name: assignTitle, exact: true })
  await chooser.getByRole('checkbox', { name: /Content editor/ }).click()
  await chooser.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(chooser).not.toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
  await details.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(details).not.toBeInTheDocument()
  expect(put).toHaveBeenCalledExactlyOnceWith(
    '/workspaces/current/rbac/members/member-1/rbac-roles',
    { body: { role_ids: [reader.id, editor.id] } },
  )
  expect(settled).toBe(false)
  await expect.element(memberEntry).toHaveFocus()
  expect(closeSettings).not.toHaveBeenCalled()
  finishUpdate()
  await expect.poll(() => clients[0]?.isMutating()).toBe(0)
})

it('preserves the menu chooser selection through immediate confirmation exit and returns visible focus before the update finishes', async () => {
  let finishUpdate!: () => void
  let settled = false
  put.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishUpdate = () => {
          settled = true
          resolve({ account_id: member.id, roles: [reader, editor] })
        }
      }),
  )
  const screen = await renderMembers()
  const menuEntry = screen.getByRole('button', { name: /workspaceMembers\.members\.memberActions/ })
  await menuEntry.click()
  await screen.getByRole('menuitem', { name: /workspaceMembers\.members\.assignRoles/ }).click()
  const chooser = screen.getByRole('dialog', { name: assignTitle, exact: true })
  const checkbox = chooser.getByRole('checkbox', { name: /Content editor/ })
  await checkbox.click()
  await chooser.getByRole('heading', { name: assignTitle }).hover()
  const popup = chooser.element()
  const checkboxElement = checkbox.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exitDraft = observeExit(
    popup,
    () => checkboxElement.getAttribute('aria-checked') === 'true',
  )
  await chooser.getByRole('button', { name: 'common.operation.confirm' }).click()
  expect(await exitDraft).toBe(true)
  await expect.element(chooser).not.toBeInTheDocument()
  expect(settled).toBe(false)
  expect(put).toHaveBeenCalledExactlyOnceWith(
    '/workspaces/current/rbac/members/member-1/rbac-roles',
    { body: { role_ids: [reader.id, editor.id] } },
  )
  await expect.element(menuEntry).toHaveFocus()
  await expect.poll(() => menuEntry.element().checkVisibility({ opacityProperty: true })).toBe(true)
  expect(closeSettings).not.toHaveBeenCalled()
  finishUpdate()
  await expect.poll(() => clients[0]?.isMutating()).toBe(0)
})
