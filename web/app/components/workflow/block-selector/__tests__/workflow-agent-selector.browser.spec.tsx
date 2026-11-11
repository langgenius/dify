import type { AgentInviteOptionResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ComponentProps } from 'react'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { NodeDefault } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { BlockEnum } from '@/app/components/workflow/types'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { AgentBlockItem } from '../agent-selector'
import { BlockClassification } from '../types'

const difyAgent: AgentInviteOptionResponse = {
  id: 'dify-agent-1',
  name: 'Research Agent',
  description: 'Researches public information.',
  role: 'Researcher',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#FFFFFF',
  active_config_snapshot_id: 'snapshot-1',
  agent_kind: 'dify_agent',
  scope: 'roster',
  source: 'workflow',
  status: 'active',
}

const mocks = vi.hoisted(() => ({ fetchAgents: vi.fn() }))
vi.mock('react-i18next', async (importOriginal) => importOriginal())
// boundary: Dify invite options are server data; source filtering and selection remain real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.inviteOptions.get': (
        input: Parameters<typeof actual.consoleClient.agent.inviteOptions.get>[0],
      ) => {
        mocks.fetchAgents(input)
        const keyword = input?.query?.keyword?.toLowerCase() ?? ''
        const data = [difyAgent].filter((agent) => agent.name.toLowerCase().includes(keyword))
        return { data, has_more: false, limit: 8, page: 1, total: data.length }
      },
    }),
  }
})

const block: NodeDefault = {
  metaData: {
    classification: BlockClassification.Default,
    sort: 3,
    type: BlockEnum.AgentV2,
    title: 'Agent',
    author: 'Dify',
    description: 'Call an agent.',
  },
  defaultValue: {},
  checkValid: () => ({ isValid: true }),
}

type AgentBlockProps = ComponentProps<typeof AgentBlockItem>

async function setup(
  resource: EditorResource = {
    kind: 'app',
    collaborationEnabled: false,
    appId: 'workflow-app',
    mode: 'workflow',
  },
) {
  await page.viewport(1100, 750)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common, navigation, workflow } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onTestFinished(() => queryClient.clear())
  const onSelect = vi.fn<AgentBlockProps['onSelect']>()
  const onSelectExternal = vi.fn<NonNullable<AgentBlockProps['onSelectExternal']>>()
  const onStartFromScratch = vi.fn()
  await render(
    <QueryClientProvider client={queryClient}>
      <EditorResourceScope resource={resource}>
        <I18nextProvider i18n={i18n}>
          <div className="isolate w-60 p-4">
            <AgentBlockItem
              block={block}
              onSelect={onSelect}
              onSelectExternal={onSelectExternal}
              onStartFromScratch={onStartFromScratch}
            />
          </div>
        </I18nextProvider>
      </EditorResourceScope>
    </QueryClientProvider>,
  )
  const trigger = page.getByRole('button', { name: /^Agent/ })
  await trigger.click()
  const picker = page.getByRole('dialog', { name: 'Select an agent', exact: true })
  await expect.element(picker).toBeVisible()
  return { picker, trigger, onSelect, onSelectExternal, onStartFromScratch }
}

beforeEach(({ onTestFinished }) => {
  mocks.fetchAgents.mockClear()
  onTestFinished(guardUnexpectedFetch())
})

it('filters the active source while sharing the search and avoiding Dify requests on External', async () => {
  const { picker } = await setup()
  const search = picker.getByRole('searchbox', { name: 'Search agents', exact: true })
  await expect
    .element(picker.getByRole('tab', { name: 'All', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.element(picker.getByRole('button', { name: /Research Agent/ })).toBeVisible()
  await expect.element(picker.getByRole('button', { name: /Contract Review Agent/ })).toBeVisible()
  await picker.getByRole('tab', { name: 'External', exact: true }).click()
  await expect
    .element(picker.getByRole('button', { name: /Research Agent/ }))
    .not.toBeInTheDocument()
  await expect
    .element(picker.getByRole('button', { name: 'Start from Scratch', exact: true }))
    .not.toBeInTheDocument()
  const requests = mocks.fetchAgents.mock.calls.length
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  await search.fill('document')
  await expect.element(search).toHaveValue('document')
  await vi.advanceTimersByTimeAsync(300)
  await expect.element(picker.getByRole('button', { name: /Document Review Agent/ })).toBeVisible()
  await expect
    .element(picker.getByRole('button', { name: /Contract Review Agent/ }))
    .not.toBeInTheDocument()
  expect(mocks.fetchAgents).toHaveBeenCalledTimes(requests)
  vi.useRealTimers()

  await picker.getByRole('tab', { name: 'Dify', exact: true }).click()
  await expect
    .poll(() => mocks.fetchAgents.mock.calls.at(-1))
    .toEqual([{ query: { app_id: 'workflow-app', limit: 8, page: 1, keyword: 'document' } }])
  await expect.element(search).toHaveValue('document')
  await expect.element(picker.getByText('No matching agents', { exact: true })).toBeVisible()
  await picker.getByRole('tab', { name: 'All', exact: true }).click()
  await expect.element(picker.getByRole('button', { name: /Document Review Agent/ })).toBeVisible()
})

it('skips disabled external agents during keyboard selection and closes with the external callback', async () => {
  const { picker, onSelect, onSelectExternal } = await setup()
  await picker.getByRole('tab', { name: 'External', exact: true }).click()
  const contract = picker.getByRole('button', { name: /Contract Review Agent/ })
  const document = picker.getByRole('button', { name: /Document Review Agent/ })
  await expect.element(picker.getByRole('button', { name: /Invoice Audit Agent/ })).toBeDisabled()
  await userEvent.tab()
  await expect
    .element(picker.getByRole('tabpanel', { name: 'External', exact: true }))
    .toHaveFocus()
  await userEvent.tab()
  await expect.element(contract).toHaveFocus()
  await userEvent.tab()
  await expect.element(document).toHaveFocus()
  await userEvent.tab()
  const manage = picker.getByRole('link', { name: 'Manage in Agents', exact: true })
  await expect.element(manage).toHaveFocus()
  await expect.element(manage).toHaveAttribute('href', '/agents')
  await userEvent.tab({ shift: true })
  await expect.element(document).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => onSelectExternal.mock.calls)
    .toEqual([[expect.objectContaining({ key: 'document-review', name: 'Document Review Agent' })]])
  expect(onSelect).not.toHaveBeenCalled()
  await expect.element(picker).not.toBeInTheDocument()
})

it('keeps Dify selection and starting from scratch as distinct actions', async () => {
  const { picker, trigger, onSelect, onSelectExternal, onStartFromScratch } = await setup()
  await picker.getByRole('button', { name: /Research Agent/ }).click()
  await expect
    .poll(() => onSelect.mock.calls)
    .toEqual([
      [
        {
          description: difyAgent.description,
          icon: difyAgent.icon,
          icon_background: difyAgent.icon_background,
          icon_type: difyAgent.icon_type,
          id: difyAgent.id,
          name: difyAgent.name,
          role: difyAgent.role,
        },
      ],
    ])
  expect(onSelectExternal).not.toHaveBeenCalled()
  await expect.element(picker).not.toBeInTheDocument()
  await trigger.click()
  await picker.getByRole('button', { name: 'Start from Scratch', exact: true }).click()
  expect(onStartFromScratch).toHaveBeenCalledOnce()
  expect(onSelect).toHaveBeenCalledOnce()
  await expect.element(picker).not.toBeInTheDocument()
})

it('resets the source and search when closing and reopening the picker', async () => {
  const { picker, trigger } = await setup()
  await picker.getByRole('tab', { name: 'External', exact: true }).click()
  await picker.getByRole('searchbox', { name: 'Search agents', exact: true }).fill('contract')
  await expect
    .element(picker.getByRole('button', { name: /Document Review Agent/ }))
    .not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(picker.getByRole('searchbox', { name: 'Search agents', exact: true }))
    .toHaveValue('')
  await userEvent.keyboard('{Escape}')
  await expect.element(picker).not.toBeInTheDocument()
  await trigger.click()
  await expect
    .element(picker.getByRole('tab', { name: 'All', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(picker.getByRole('searchbox', { name: 'Search agents', exact: true }))
    .toHaveValue('')
  await expect.element(picker.getByRole('button', { name: /Research Agent/ })).toBeVisible()
  await expect.element(picker.getByRole('button', { name: /Document Review Agent/ })).toBeVisible()
})

it('keeps external previews out of snippet selection and omits the workflow app filter', async () => {
  const { picker } = await setup({ kind: 'snippet', snippetId: 'snippet-1' })
  await expect
    .element(picker.getByRole('tab', { name: 'External', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(picker.getByRole('button', { name: /Contract Review Agent/ }))
    .not.toBeInTheDocument()
  await expect
    .poll(() => mocks.fetchAgents.mock.calls.at(-1))
    .toEqual([{ query: { limit: 8, page: 1 } }])
})
