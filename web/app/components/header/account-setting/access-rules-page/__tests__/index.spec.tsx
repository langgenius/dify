import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createAccessPolicyFixture } from '@/test/fixtures/access-policy'
import AccessRulesPage from '../index'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

const pagination = { total_count: 1, per_page: 20, current_page: 1, total_pages: 1 }
const providers = {
  app: consoleQuery.workspaces.current.rbac.workspace.apps.accessPolicy.get,
  dataset: consoleQuery.workspaces.current.rbac.workspace.datasets.accessPolicy.get,
  agent: consoleQuery.workspaces.current.rbac.workspace.agents.accessPolicy.get,
}
const resourceTypes = ['app', 'dataset', 'agent'] as const
const sent: Request[] = []

function setup({ canManage = true, builtin = false } = {}) {
  const { wrapper, queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: canManage ? ['workspace.role.manage'] : [],
  })
  for (const resourceType of resourceTypes) {
    const rule = createAccessPolicyFixture({
      id: `${resourceType}-rule`,
      resource_type: resourceType,
      name: `${resourceType} rule`,
      permission_keys: [`${resourceType}.acl.edit`],
      is_builtin: builtin,
    })
    queryClient.setQueryData(
      providers[resourceType].infiniteOptions({
        input: (page) => ({ query: { language: 'en', page, limit: 20 } }),
        initialPageParam: 1,
        getNextPageParam: () => undefined,
      }).queryKey,
      {
        pages: [{ items: [{ policy: rule, accounts: [], roles: [] }], pagination }],
        pageParams: [1],
      },
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.rbac.rolePermissions.catalog[resourceType].get.queryKey({
        input: {},
      }),
      {
        groups: [
          {
            group_key: `${resourceType}_acl`,
            group_name: resourceType,
            description: '',
            permissions: [
              { key: `${resourceType}.acl.edit`, name: 'Edit configuration', description: '' },
            ],
          },
        ],
      },
    )
  }
  request.mockImplementation(
    async (_url: string, _init: RequestInit, options: { request: Request }) => {
      const req = options.request
      sent.push(req.clone())
      if (req.method === 'GET') {
        const resourceType = new URL(req.url).pathname.includes('/datasets/')
          ? 'dataset'
          : new URL(req.url).pathname.includes('/apps/')
            ? 'app'
            : 'agent'
        return Response.json({
          items: [
            {
              policy: createAccessPolicyFixture({ resource_type: resourceType }),
              accounts: [],
              roles: [],
            },
          ],
          pagination,
        })
      }
      return Response.json(createAccessPolicyFixture())
    },
  )
  return { ...render(<AccessRulesPage />, { wrapper }), queryClient }
}

async function openSection(resourceType: (typeof resourceTypes)[number]) {
  const trigger = screen.getByRole('button', {
    name: new RegExp(`^permission.accessRule.${resourceType}Title`),
  })
  if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.click(trigger)
  return trigger.closest('section')!
}

describe('AccessRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sent.length = 0
  })

  it('renders App, Dataset, and Agent permission sets', () => {
    setup()
    for (const type of resourceTypes)
      expect(
        screen.getByRole('button', { name: new RegExp(`^permission.accessRule.${type}Title`) }),
      ).toBeInTheDocument()
  })

  it.each(resourceTypes)(
    'creates a %s permission set through the generated endpoint',
    async (type) => {
      setup()
      const section = await openSection(type)
      await userEvent.click(
        within(section).getByRole('button', { name: 'permission.accessRule.newPermissionSet' }),
      )
      const dialog = screen.getByRole('dialog')
      await userEvent.type(
        within(dialog).getByRole('textbox', { name: /permissionSet.nameLabel/ }),
        'Custom policy',
      )
      await userEvent.click(
        within(dialog).getByRole('checkbox', { name: new RegExp(`${type}.acl.edit`) }),
      )
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'common.operation.confirm' }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      const mutation = sent.find((req) => req.method === 'POST')!
      expect(new URL(mutation.url).pathname).toMatch(/\/rbac\/access-policies$/)
      expect(await mutation.json()).toEqual({
        name: 'Custom policy',
        description: '',
        permission_keys: [`${type}.acl.edit`],
        resource_type: type,
      })
    },
  )

  it.each(resourceTypes)(
    'updates a %s permission set with the generated request body',
    async (type) => {
      setup()
      const section = await openSection(type)
      await userEvent.click(
        within(section).getByRole('button', { name: 'common.operation.moreActions' }),
      )
      await userEvent.click(screen.getByRole('menuitem', { name: 'common.operation.edit' }))
      await userEvent.type(
        screen.getByRole('textbox', { name: 'permission.permissionSet.descriptionLabel' }),
        ' updated',
      )
      await userEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      const mutation = sent.find((req) => req.method === 'PUT')!
      expect(new URL(mutation.url).pathname).toMatch(new RegExp(`/access-policies/${type}-rule$`))
      expect(await mutation.json()).toMatchObject({
        name: `${type} rule`,
        description: 'Edit Agent configuration updated',
        permission_keys: [`${type}.acl.edit`],
      })
    },
  )

  it('keeps built-in Agent policies read-only and offers duplication', async () => {
    setup({ builtin: true })
    const section = await openSection('agent')
    await userEvent.click(
      within(section).getByRole('button', { name: 'common.operation.moreActions' }),
    )
    expect(
      screen.queryByRole('menuitem', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'permission.common.duplicateAction' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'common.operation.view' }))
    expect(screen.getByRole('textbox', { name: /permissionSet.nameLabel/ })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'common.operation.confirm' }),
    ).not.toBeInTheDocument()
  })

  it('closes a mutation dialog when role management is revoked', async () => {
    const { queryClient } = setup()
    const section = await openSection('agent')
    await userEvent.click(
      within(section).getByRole('button', { name: 'permission.accessRule.newPermissionSet' }),
    )
    act(() => {
      seedWorkspacePermissionsQuery(queryClient, [])
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: 'permission.accessRule.newPermissionSet' }),
    ).not.toBeInTheDocument()
    expect(sent.filter((req) => req.method !== 'GET')).toHaveLength(0)
  })
})
