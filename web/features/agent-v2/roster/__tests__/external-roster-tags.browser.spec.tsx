import type { ExternalAgentAssetResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'
import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AgentPermission } from '@/features/agent-v2/acl'
import { createExternalAgentAsset } from '@/test/console/external-agents'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createRosterFixture, resetRoster, server, vendorId } from './external-roster-fixture'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.externalAgents.get>(),
  capabilities: vi.fn(),
  detail: vi.fn(),
  references: vi.fn(),
  info: vi.fn(),
  enabled: vi.fn(),
  remove: vi.fn(),
  difyList: vi.fn(),
  tags: vi.fn<typeof consoleClient.tags.get>(),
  deleteTag: vi.fn<typeof consoleClient.tags.byTagId.delete>(),
  bind: vi.fn<typeof consoleClient.tagBindings.post>(),
  unbind: vi.fn<typeof consoleClient.tagBindings.remove.post>(),
}))

// boundary: transport supplies shared tag and asset records; the real roster, tag controls and cache policies own the interaction.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.get': api.difyList,
      'externalAgents.get': api.list,
      'externalAgents.capabilities.get': api.capabilities,
      'externalAgents.byAgentId.get': api.detail,
      'externalAgents.byAgentId.references.get': api.references,
      'externalAgents.byAgentId.info.patch': api.info,
      'externalAgents.byAgentId.enabled.put': api.enabled,
      'externalAgents.byAgentId.delete': api.remove,
      'tags.get': api.tags,
      'tags.byTagId.delete': api.deleteTag,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'tagBindings.post': api.bind,
      'tagBindings.remove.post': api.unbind,
    }),
  }
})
// boundary: real English translations supply the user-facing control names in this feature journey.
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: route navigation belongs to the application host, not the tag classification journey.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const research = { id: 'research', name: 'Research', type: 'agent' }
const finance = { id: 'finance', name: 'Finance', type: 'agent' }
let catalog: (typeof research)[]
const card = (name: string) => page.getByRole('listitem', { name, exact: true })

async function setup(options?: Parameters<typeof createRosterFixture>[0]) {
  await page.viewport(1440, 900)
  const fixture = await createRosterFixture(options)
  const rendered = await render(fixture.ui)
  onTestFinished(async () => {
    await rendered.unmount()
    fixture.queryClient.clear()
  })
  return fixture
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  resetRoster(api)
  catalog = [research, finance]
  api.tags.mockReset().mockImplementation(async () => catalog)
  api.deleteTag.mockReset().mockImplementation(async ({ params }) => {
    catalog = catalog.filter((tag) => tag.id !== params.tag_id)
  })
  server.assets = server.assets.map((asset) => ({
    ...asset,
    tags: [research],
    permission_keys: asset.id === vendorId ? [AgentPermission.Edit] : [],
  }))
  api.bind.mockReset().mockImplementation(async ({ body }) => {
    server.assets = server.assets.map((asset) =>
      asset.id === body.target_id
        ? {
            ...asset,
            tags: [...asset.tags, ...catalog.filter((tag) => body.tag_ids.includes(tag.id))],
          }
        : asset,
    )
    return { result: 'success' }
  })
  api.unbind.mockReset().mockResolvedValue({ result: 'success' })
})

it('lets an Editor classify a disabled External Agent using its resource permission without granting management actions', async () => {
  await setup({ role: 'editor', workspacePermissionKeys: ['agent.tag.manage'] })
  const vendor = card('Vendor Screening Agent')
  const selector = vendor.getByRole('combobox', {
    name: 'Research: Vendor Screening Agent',
    exact: true,
  })
  await selector.click()
  await page.getByRole('option', { name: 'Finance', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(
      vendor.getByRole('combobox', {
        name: 'Research, Finance: Vendor Screening Agent',
        exact: true,
      }),
    )
    .toBeVisible()
  expect(api.bind).toHaveBeenCalledExactlyOnceWith({
    body: {
      tag_ids: ['finance'],
      target_id: vendorId,
      type: 'agent',
    },
  })
  expect(api.unbind).not.toHaveBeenCalled()
  await expect
    .element(page.getByRole('button', { name: 'Connect external agent', exact: true }))
    .not.toBeInTheDocument()
  await expect.element(vendor.getByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
  expect(api.info).not.toHaveBeenCalled()
  expect(api.enabled).not.toHaveBeenCalled()
  expect(api.remove).not.toHaveBeenCalled()
})

it('keeps tags read-only when the asset has no edit grant even for a workspace manager', async () => {
  await setup({ role: 'owner', workspacePermissionKeys: ['agent.tag.manage'] })
  const contract = card('Contract Review Agent')
  await expect
    .element(
      contract.getByRole('combobox', { name: 'Research: Contract Review Agent', exact: true }),
    )
    .not.toBeInTheDocument()
  await contract
    .getByRole('button', { name: 'Research: Contract Review Agent', exact: true })
    .click()
  const tags = page.getByRole('dialog', { name: 'Tags: Contract Review Agent', exact: true })
  await expect.element(tags.getByRole('listitem')).toHaveTextContent('Research')
  expect(api.bind).not.toHaveBeenCalled()
  expect(api.unbind).not.toHaveBeenCalled()
})

it('keeps sorting while paging tag results and clearing all filters without a search', async () => {
  const matches: ExternalAgentAssetResponse[] = Array.from({ length: 20 }, (_, index) =>
    createExternalAgentAsset({
      id: `matching-${index}`,
      name: `Matching Agent ${index + 1}`,
      tags: [research],
    }),
  )
  const later = createExternalAgentAsset({
    id: 'later',
    name: 'Later matching Agent',
    tags: [research],
  })
  api.list.mockImplementation(async (input) => {
    const query = input?.query ?? {}
    const both = query.tag_ids?.length === 2
    return {
      items: both ? [] : query.page === 2 ? [later] : matches,
      total: both ? 0 : 21,
      enabled_count: both ? 0 : 21,
      disabled_count: 1,
      limit: 20,
      page: query.page ?? 1,
    }
  })
  const { onUrlUpdate } = await setup({
    searchParams:
      '?external_tag_ids=research&external_status=enabled&external_connected_by_me=true&external_sort_by=earliest_created',
  })
  await expect.element(card('Matching Agent 1')).toBeVisible()
  await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect.element(card('Later matching Agent')).toBeVisible()
  expect(api.list).toHaveBeenLastCalledWith({
    query: {
      page: 2,
      limit: 20,
      tag_ids: ['research'],
      enabled: true,
      connected_by_me: true,
      sort_by: 'created_at',
      sort_order: 'asc',
    },
  })
  await page.getByRole('combobox', { name: 'Research', exact: true }).click()
  await page.getByRole('option', { name: 'Finance', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('button', { name: 'Clear filters', exact: true }))
    .toBeVisible()
  expect(api.list).toHaveBeenLastCalledWith({
    query: {
      page: 1,
      limit: 20,
      tag_ids: ['research', 'finance'],
      enabled: true,
      connected_by_me: true,
      sort_by: 'created_at',
      sort_order: 'asc',
    },
  })
  await expect.element(page.getByRole('radio', { name: 'Enabled 0', exact: true })).toBeChecked()
  await expect.element(page.getByRole('radio', { name: 'Disabled 1', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect.element(card('Matching Agent 1')).toBeVisible()
  await expect.element(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
  await expect.element(page.getByRole('radio', { name: 'All', exact: true })).toHaveFocus()
  await expect
    .element(page.getByRole('checkbox', { name: 'Connected by me', exact: true }))
    .not.toBeChecked()
  expect(api.list).toHaveBeenLastCalledWith({
    query: {
      page: 1,
      limit: 20,
      connected_by_me: false,
      sort_by: 'created_at',
      sort_order: 'asc',
    },
  })
  expect(Object.fromEntries(onUrlUpdate.mock.lastCall?.[0].searchParams ?? [])).toEqual({
    external_sort_by: 'earliest_created',
  })
})

it('reconciles bookmarked tags with the shared catalog and drops a deleted selected tag', async () => {
  const pending = createDeferred<TagResponse[]>()
  api.tags.mockReturnValue(pending.promise)
  const { onUrlUpdate } = await setup({
    role: 'editor',
    workspacePermissionKeys: ['agent.tag.manage'],
    searchParams: '?external_tag_ids=gone;research;finance&layout=grid',
  })
  pending.resolve(catalog)
  api.tags.mockImplementation(async () => catalog)
  await expect
    .element(page.getByRole('combobox', { name: 'Research, Finance', exact: true }))
    .toBeVisible()
  await page.getByRole('combobox', { name: 'Research, Finance', exact: true }).click()
  await page.getByRole('button', { name: 'Manage Tags', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Manage Tags', exact: true })
  await expect.element(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Remove Research', exact: true }).click()
  await expect
    .poll(() => Object.fromEntries(onUrlUpdate.mock.lastCall?.[0].searchParams ?? []))
    .toEqual({ external_tag_ids: 'finance', layout: 'grid' })
  expect(api.deleteTag).toHaveBeenCalledExactlyOnceWith({ params: { tag_id: research.id } })
  expect(api.list.mock.lastCall?.[0]?.query?.tag_ids).toEqual(['finance'])
  expect(api.bind).not.toHaveBeenCalled()
})
