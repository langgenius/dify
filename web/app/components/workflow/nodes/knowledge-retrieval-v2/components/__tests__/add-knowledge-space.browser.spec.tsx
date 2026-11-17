import type { KnowledgeRetrievalV2SpaceSummary } from '../../types'
import type { consoleClient } from '@/service/console'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import AddKnowledgeSpace from '../add-knowledge-space'

type Space = Awaited<ReturnType<typeof consoleClient.knowledgeFs.spaces.get>>['data'][number]

const api = vi.hoisted(() => ({ list: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'knowledgeFs.spaces.get': api.list }),
  }
})

const space = (id: string, name: string, overrides: Partial<Space> = {}): Space => ({
  control_space_id: id,
  created_at: '2026-08-18T00:00:00Z',
  knowledge_space_id: id,
  linked_apps: 0,
  owner_account_id: 'account-1',
  permission_keys: [
    'knowledge_space_read',
    'knowledge_space_query',
    'knowledge_space_access_config',
  ],
  resource_version: 1,
  state: 'active',
  technical_status: 'available',
  technical_summary: {
    knowledge_space_id: id,
    name,
    revision: 1,
    slug: id,
    description: null,
    document_count: 0,
  },
  updated_at: '2026-08-18T00:00:00Z',
  visibility: 'only_me',
  ...overrides,
})
const response = (data: Space[], page = 1, has_more = false) => ({
  data,
  page,
  has_more,
  limit: 50,
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  api.list.mockReset().mockResolvedValue(
    response([
      space('product', 'Product docs', {
        technical_summary: {
          knowledge_space_id: 'product',
          name: 'Product docs',
          revision: 1,
          slug: 'product',
          icon: '📘',
          description: null,
          document_count: 0,
        },
      }),
      space('archive', 'Archived docs', { technical_status: 'unavailable' }),
    ]),
  )
})

async function setup(initial: KnowledgeRetrievalV2SpaceSummary[] = []) {
  function Selection() {
    const [selected, setSelected] = useState(initial)
    return (
      <>
        <AddKnowledgeSpace selectedSpaces={selected} onChange={setSelected} />
        <output aria-label="Selected knowledge">
          {selected.map(({ name, icon }) => `${icon ?? ''}${name}`).join(', ') || 'None'}
        </output>
      </>
    )
  }
  const { queryClient } = createConsoleQueryWrapper()
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <Selection />
    </QueryClientTestProvider>,
  )
  const trigger = screen.getByRole('button', {
    name: 'common.operation.add workflow.nodes.knowledgeRetrievalV2.knowledgeSpaces',
  })
  await trigger.click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog).toBeVisible()
  return {
    screen,
    dialog,
    trigger,
    saved: screen.getByRole('status', { name: 'Selected knowledge' }),
  }
}

it('replaces an unavailable saved space and retains the confirmed catalog selection when reopened', async () => {
  const { screen, dialog, trigger, saved } = await setup([
    { control_space_id: 'archive', name: 'Archived docs' },
  ])
  const archived = dialog.getByRole('checkbox', { name: 'Archived docs' })
  const product = dialog.getByRole('checkbox', { name: 'Product docs' })
  await expect.element(archived).toBeChecked()
  await expect.element(archived).toBeEnabled()
  await archived.click()
  await product.click()
  await expect.element(product).toBeChecked()
  await dialog.getByRole('button', { name: 'common.operation.add', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(saved).toHaveTextContent('📘Product docs')
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(product).toBeChecked()
  await expect.element(archived).not.toBeChecked()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
})

it.each(['all_team_members', 'partial_members'] as const)(
  'confirms a %s space with read and query access',
  async (visibility) => {
    api.list.mockResolvedValue(
      response([
        space('shared', 'Shared docs', {
          visibility,
          permission_keys: ['knowledge_space_read', 'knowledge_space_query'],
        }),
      ]),
    )
    const { dialog, saved } = await setup()
    await dialog.getByRole('checkbox', { name: 'Shared docs' }).click()
    await dialog.getByRole('button', { name: 'common.operation.add', exact: true }).click()
    await expect.element(saved).toHaveTextContent('Shared docs')
  },
)

it.each([
  { permission_keys: ['knowledge_space_query'] },
  { permission_keys: ['knowledge_space_read'] },
  { state: 'deleting' },
] satisfies Partial<Space>[])(
  'prevents confirming a catalog space publishing would reject: %j',
  async (overrides) => {
    api.list.mockResolvedValue(response([space('restricted', 'Restricted docs', overrides)]))
    const { dialog, saved } = await setup()
    const restricted = dialog.getByRole('checkbox', { name: 'Restricted docs' })
    await expect.element(restricted).toBeDisabled()
    await expect
      .element(dialog.getByText('workflow.nodes.knowledgeRetrievalV2.unavailable'))
      .toBeVisible()
    await dialog.getByRole('button', { name: 'common.operation.add', exact: true }).click()
    await expect.element(saved).toHaveTextContent('None')
  },
)

it('recovers the initial catalog through its retry action', async () => {
  api.list.mockRejectedValueOnce(new Error('spaces unavailable'))
  const { dialog } = await setup()
  const alert = dialog.getByRole('alert')
  await expect
    .element(alert)
    .toMatchTextContent('workflow.nodes.knowledgeRetrievalV2.loadSpacesError')
  await expect
    .element(dialog.getByText('workflow.nodes.knowledgeRetrievalV2.noSpaces'))
    .not.toBeInTheDocument()
  await alert.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(dialog.getByRole('checkbox', { name: 'Product docs' })).toBeVisible()
  await expect.element(alert).not.toBeInTheDocument()
})

it('retains the loaded page and its selection while retrying the failed next page', async () => {
  api.list.mockImplementation(
    async (input: Parameters<typeof consoleClient.knowledgeFs.spaces.get>[0]) => {
      if (input?.query?.page === 1) return response([space('product', 'Product docs')], 1, true)
      throw new Error('next page unavailable')
    },
  )
  const { dialog, saved } = await setup()
  const product = dialog.getByRole('checkbox', { name: 'Product docs' })
  await product.click()
  const alert = dialog.getByRole('alert')
  await expect.element(alert).toBeVisible()
  api.list.mockImplementation(
    async (input: Parameters<typeof consoleClient.knowledgeFs.spaces.get>[0]) => {
      if (input?.query?.page !== 2) throw new Error('The retry must request the failed second page')
      return response([space('later', 'Later docs')], 2)
    },
  )
  await alert.getByRole('button', { name: 'common.operation.retry' }).click()
  const later = dialog.getByRole('checkbox', { name: 'Later docs' })
  await expect.element(later).toBeVisible()
  await expect.element(product).toBeChecked()
  await later.click()
  await dialog.getByRole('button', { name: 'common.operation.add', exact: true }).click()
  await expect.element(saved).toHaveTextContent('Product docs, Later docs')
})
