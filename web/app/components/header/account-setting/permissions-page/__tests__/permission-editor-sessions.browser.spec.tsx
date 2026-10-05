import type { Role, RoleListResponse } from '@/models/access-control'
import { QueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createAccessPolicyFixture } from '@/test/fixtures/access-policy'
import AccessRulesPage from '../../access-rules-page'
import PermissionsPage from '../index'

const { get, post, put, request, savePolicy } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  request: vi.fn(),
  savePolicy: vi.fn(),
}))
vi.mock('@/service/base', () => ({ get, post, put, request, del: vi.fn(), patch: vi.fn() }))

const role: Role = {
  id: 'custom-role',
  tenant_id: 'workspace-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Custom operator',
  description: 'Original role description',
  is_builtin: false,
  permission_keys: ['workspace.member.manage'],
  role_tag: '',
}
const builtin: Role = {
  ...role,
  id: 'builtin-role',
  name: 'Built-in reader',
  category: 'global_system_default',
  is_builtin: true,
}
const pagination = { total_count: 2, per_page: 20, current_page: 1, total_pages: 1 }
const roleList: RoleListResponse = { data: [builtin, role], pagination }
const catalog = (key: string) => ({
  groups: [
    {
      group_key: 'workspace_management',
      group_name: 'Workspace permissions',
      description: '',
      permissions: [{ key, name: 'Manage access', description: '' }],
    },
  ],
})
const clients: QueryClient[] = []
function RolePage() {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={containerRef}>
      <PermissionsPage containerRef={containerRef} />
    </div>
  )
}
async function setup(resource = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  })
  clients.push(client)
  seedAccountProfileQuery(client, { interface_language: 'en-US' })
  const permissions = seedWorkspacePermissionsQuery(client, ['workspace.role.manage'])
  client.setQueryData(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog.get.queryKey({ input: {} }),
    catalog('workspace.member.manage'),
  )
  const providers = {
    app: consoleQuery.workspaces.current.rbac.workspace.apps.accessPolicy.get,
    dataset: consoleQuery.workspaces.current.rbac.workspace.datasets.accessPolicy.get,
    agent: consoleQuery.workspaces.current.rbac.workspace.agents.accessPolicy.get,
  }
  for (const type of ['app', 'dataset', 'agent'] as const) {
    client.setQueryData(
      providers[type].infiniteOptions({
        input: (p) => ({ query: { language: 'en', page: p, limit: 20 } }),
        initialPageParam: 1,
        getNextPageParam: () => undefined,
      }).queryKey,
      {
        pages: [
          {
            items: [
              {
                policy: createAccessPolicyFixture({
                  id: `${type}-rule`,
                  name: `${type} editors`,
                  resource_type: type,
                  permission_keys: [`${type}.acl.edit`],
                }),
                accounts: [],
                roles: [],
              },
            ],
            pagination,
          },
        ],
        pageParams: [1],
      },
    )
    client.setQueryData(
      consoleQuery.workspaces.current.rbac.rolePermissions.catalog[type].get.queryKey({
        input: {},
      }),
      catalog(`${type}.acl.edit`),
    )
  }
  get.mockResolvedValue(roleList)
  request.mockImplementation((_url: string, _init: RequestInit, options: { request: Request }) => {
    const req = options.request
    if (req.method !== 'GET') return savePolicy()
    if (new URL(req.url).pathname.endsWith('/my-permissions'))
      return Promise.resolve(Response.json(permissions))
    const type = new URL(req.url).pathname.includes('/datasets/')
      ? 'dataset'
      : new URL(req.url).pathname.includes('/apps/')
        ? 'app'
        : 'agent'
    return Promise.resolve(
      Response.json({
        items: [
          {
            policy: createAccessPolicyFixture({
              id: `${type}-rule`,
              name: `${type} editors`,
              resource_type: type,
              permission_keys: [`${type}.acl.edit`],
            }),
            accounts: [],
            roles: [],
          },
        ],
        pagination,
      }),
    )
  })
  return render(
    <QueryClientTestProvider queryClient={client}>
      {resource ? <AccessRulesPage /> : <RolePage />}
    </QueryClientTestProvider>,
  )
}
async function observeExit(element: Element, field: HTMLInputElement) {
  await expect
    .poll(
      () =>
        !element.hasAttribute('data-starting-style') &&
        element.getAnimations().every((animation) => animation.playState === 'finished'),
    )
    .toBe(true)
  const result = { value: undefined as string | undefined }
  element.addEventListener('transitionrun', () => {
    if (element.hasAttribute('data-ending-style')) result.value = field.value
  })
  return result
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
it('retains a new role draft through exit and returns to Add before a fresh session', async () => {
  const screen = await setup()
  const add = screen.getByRole('button', { name: 'permission.role.addRole' })
  await expect.element(add).toBeEnabled()
  await add.click()
  const dialog = screen.getByRole('dialog', { name: 'permission.role.modal.create.title' })
  const name = dialog.getByRole('textbox', { name: 'permission.role.modal.nameLabel' })
  await name.fill('Unsaved role')
  await dialog.getByRole('checkbox', { name: /workspace.member.manage/ }).click()
  const element = dialog.element()
  const exit = await observeExit(element, name.element() as HTMLInputElement)
  await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.poll(() => exit.value).toBe('Unsaved role')
  await expect.poll(() => element.isConnected).toBe(false)
  await expect.element(add).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(name).toHaveValue('')
  await expect
    .element(dialog.getByRole('checkbox', { name: /workspace.member.manage/ }))
    .not.toBeChecked()
  await expect
    .element(dialog.getByRole('button', { name: 'common.operation.confirm' }))
    .toBeDisabled()
})
it('closes a role edit before PUT finishes and returns to its actual row menu', async () => {
  let complete!: (value: Role) => void
  put.mockReturnValue(
    new Promise<Role>((resolve) => {
      complete = resolve
    }),
  )
  const screen = await setup()
  await expect.element(screen.getByText(role.name, { exact: true })).toBeVisible()
  const more = screen.getByRole('button', { name: 'common.operation.moreActions' }).nth(1)
  await more.click()
  await screen.getByRole('menuitem', { name: 'common.operation.edit' }).click()
  const dialog = screen.getByRole('dialog', { name: 'permission.role.modal.edit.title' })
  const description = dialog.getByRole('textbox', {
    name: 'permission.role.modal.descriptionLabel',
  })
  await description.fill('Updated description')
  const element = dialog.element()
  const exit = await observeExit(element, description.element() as HTMLInputElement)
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.poll(() => exit.value).toBe('Updated description')
  await expect.poll(() => element.isConnected).toBe(false)
  expect(put).toHaveBeenCalledOnce()
  await expect.element(more).toHaveFocus()
  complete(role)
  await expect.poll(() => get.mock.calls.length).toBe(2)
  await screen.getByRole('button', { name: 'common.operation.moreActions' }).first().click()
  await screen.getByRole('menuitem', { name: 'common.operation.view' }).click()
  const view = screen.getByRole('dialog', { name: 'permission.role.modal.view.title' })
  await expect
    .element(view.getByRole('textbox', { name: 'permission.role.modal.nameLabel' }))
    .toHaveValue(builtin.name)
  await expect
    .element(view.getByRole('textbox', { name: 'permission.role.modal.nameLabel' }))
    .toBeDisabled()
})
it('retains permission-set edits through cancel and waits for a successful save before closing', async () => {
  let complete!: (value: Response) => void
  savePolicy.mockReturnValue(
    new Promise<Response>((resolve) => {
      complete = resolve
    }),
  )
  const screen = await setup(true)
  const more = screen.getByRole('button', { name: 'common.operation.moreActions' })
  await more.click()
  await screen.getByRole('menuitem', { name: 'common.operation.edit' }).click()
  const dialog = screen.getByRole('dialog', {
    name: 'permission.permissionSet.modal.edit.app.title',
  })
  const name = dialog.getByRole('textbox', { name: /permissionSet.nameLabel/ })
  await name.fill('Unsaved permission set')
  const element = dialog.element()
  const exit = await observeExit(element, name.element() as HTMLInputElement)
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => exit.value).toBe('Unsaved permission set')
  await expect.poll(() => element.isConnected).toBe(false)
  await expect.element(more).toHaveFocus()
  await more.click()
  await screen.getByRole('menuitem', { name: 'common.operation.edit' }).click()
  await expect.element(name).toHaveValue('app editors')
  await name.fill('Saved permission set')
  await dialog.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.poll(() => savePolicy.mock.calls.length).toBe(1)
  await expect.element(dialog).toBeVisible()
  await expect.element(name).toHaveValue('Saved permission set')
  const reopened = dialog.element()
  complete(Response.json(createAccessPolicyFixture()))
  await expect.poll(() => reopened.isConnected).toBe(false)
  await expect.element(more).toHaveFocus()
})
