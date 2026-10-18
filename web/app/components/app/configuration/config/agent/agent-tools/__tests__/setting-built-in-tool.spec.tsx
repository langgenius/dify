import type { ComponentProps } from 'react'
import type { Credential } from '@/app/components/plugins/plugin-auth/types'
import { zToolApiEntity } from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { selectToolProvider } from '@/app/components/tools/utils/query-select'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import SettingBuiltInTool from '../setting-built-in-tool'

const api = vi.hoisted(() => ({
  builtin:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.builtin.byProvider.tools.get
    >(),
  custom:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.tools.get
    >(),
  workflow:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.workflow.tools.get
    >(),
  credentials: vi.fn<
    (url: string) => Promise<{
      supported_credential_types: string[]
      credentials: Credential[]
      is_oauth_custom_client_enabled: boolean
    }>
  >(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.toolProvider.builtin.byProvider.tools.get': api.builtin,
      'workspaces.current.toolProvider.api.tools.get': api.custom,
      'workspaces.current.toolProvider.workflow.tools.get': api.workflow,
    }),
  }
})
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: api.credentials,
}))

const tool = zToolApiEntity.parse({
  name: 'search',
  author: 'Team',
  label: { en_US: 'Search Tool' },
  description: { en_US: 'Search documents' },
  parameters: [
    {
      name: 'query',
      label: { en_US: 'Query' },
      type: 'string',
      form: 'llm',
      human_description: { en_US: 'Search query' },
    },
    {
      name: 'settingParam',
      label: { en_US: 'Setting Param' },
      type: 'string',
      form: 'form',
      required: true,
      human_description: { en_US: 'Setting description' },
    },
  ],
})
const provider = createToolProviderFixture({
  id: 'provider-id',
  name: 'provider',
  allow_delete: false,
  tools: [tool],
})
const renderTool = (props: Partial<ComponentProps<typeof SettingBuiltInTool>> = {}) => {
  const onSave = vi.fn()
  const onAuthorizationItemClick = vi.fn()
  renderWithConsoleQuery(
    <SettingBuiltInTool
      collection={selectToolProvider(provider)}
      toolName="search"
      setting={{ settingParam: 'value' }}
      onHide={vi.fn()}
      onSave={onSave}
      onAuthorizationItemClick={onAuthorizationItemClick}
      {...props}
    />,
    { workspacePermissionKeys: ['credential.use'] },
  )
  return { onSave, onAuthorizationItemClick }
}
beforeEach(() => {
  api.builtin.mockReset().mockResolvedValue([tool])
  api.custom.mockReset().mockResolvedValue([tool])
  api.workflow.mockReset().mockResolvedValue([tool])
  api.credentials.mockReset().mockImplementation(async (url) => {
    if (url !== '/workspaces/current/tool-provider/builtin/vendor/provider/credential/info')
      throw new Error(`Unexpected credential request: ${url}`)
    return {
      supported_credential_types: ['api-key'],
      is_oauth_custom_client_enabled: false,
      credentials: [
        {
          id: 'credential-id',
          name: 'Team credential',
          provider: 'vendor/provider',
          credential_type: 'api-key',
          is_default: true,
        },
      ],
    }
  })
})
afterEach(async () => {
  await act(async () => cleanup())
})

it.each(['builtin', 'api', 'workflow'] as const)(
  'loads %s actions when the provider does not include them',
  async (type) => {
    renderTool({
      collection: selectToolProvider(createToolProviderFixture({ ...provider, type, tools: [] })),
      isBuiltIn: type === 'builtin',
    })
    expect(await screen.findByRole('dialog', { name: 'Search Tool' })).toBeInTheDocument()
    expect(await screen.findByRole('textbox', { name: /Setting Param/ })).toHaveValue('value')
    if (type === 'builtin')
      expect(api.builtin).toHaveBeenCalledWith({ params: { provider: 'provider' } })
    else if (type === 'api')
      expect(api.custom).toHaveBeenCalledWith({ query: { provider: 'provider' } })
    else expect(api.workflow).toHaveBeenCalledWith({ query: { workflow_tool_id: 'provider-id' } })
  },
)

it('requires settings before saving and preserves the draft across the parameter tab', async () => {
  const user = userEvent.setup()
  const { onSave } = renderTool({ setting: {} })
  const input = await screen.findByRole('textbox', { name: /Setting Param/ })
  expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
  await user.type(input, 'Unsaved draft')
  await user.click(screen.getByRole('tab', { name: 'tools.setBuiltInTools.parameters' }))
  expect(
    screen.getByRole('tabpanel', { name: 'tools.setBuiltInTools.parameters' }),
  ).toHaveTextContent('Search query')
  await user.click(screen.getByRole('tab', { name: 'tools.setBuiltInTools.setting' }))
  expect(screen.getByRole('textbox', { name: /Setting Param/ })).toHaveValue('Unsaved draft')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ settingParam: 'Unsaved draft' })
})

it('limits the default read-only view to action parameters', async () => {
  renderTool({ readonly: true })
  expect(await screen.findByText('Query')).toBeInTheDocument()
  expect(
    screen.queryByRole('tab', { name: 'tools.setBuiltInTools.setting' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
})

it('selects an available credential through the real authorization menu', async () => {
  const user = userEvent.setup()
  const { onAuthorizationItemClick } = renderTool({
    collection: selectToolProvider(
      createToolProviderFixture({
        ...provider,
        name: 'vendor/provider',
        plugin_id: 'vendor/provider',
        allow_delete: true,
        is_team_authorization: true,
      }),
    ),
  })
  await user.click(await screen.findByRole('button', { name: 'plugin.auth.workspaceDefault' }))
  const menu = await screen.findByRole('dialog', { name: 'plugin.auth.authorizations' })
  await user.click(within(menu).getByText('Team credential'))
  expect(onAuthorizationItemClick).toHaveBeenCalledExactlyOnceWith('credential-id')
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'plugin.auth.authorizations' }),
    ).not.toBeInTheDocument(),
  )
})
