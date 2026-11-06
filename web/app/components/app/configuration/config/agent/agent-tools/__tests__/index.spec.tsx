import type { ModelConfig } from '@/models/debug'
import type { AgentTool } from '@/types/app'
import { zToolApiEntity } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useMemo, useState } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import ConfigContext from '@/context/debug-configuration'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import {
  createDebugConfigurationFixture,
  createModelConfigFixture,
} from '@/test/fixtures/debug-configuration'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { writeTextToClipboard } from '@/utils/clipboard'
import AgentTools from '../index'

// Credential loading and clipboard writes are external boundaries. The picker,
// settings drawer, authorization menu and configuration caller remain live.
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: async (url: string) => {
    if (
      !url.startsWith('/workspaces/current/tool-provider/builtin/vendor/provider-1/credential/info')
    )
      throw new Error(`Unexpected request: ${url}`)
    return {
      supported_credential_types: ['api-key'],
      is_oauth_custom_client_enabled: false,
      credentials: [
        {
          id: 'credential-search',
          name: 'Search credential',
          provider: 'vendor/provider-1',
          credential_type: 'api-key',
          is_default: true,
        },
        {
          id: 'credential-translate',
          name: 'Translate credential',
          provider: 'vendor/provider-1',
          credential_type: 'api-key',
          is_default: false,
        },
        {
          id: 'credential-updated',
          name: 'Replacement credential',
          provider: 'vendor/provider-1',
          credential_type: 'api-key',
          is_default: false,
        },
      ],
    }
  },
}))

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn().mockResolvedValue(undefined),
}))

const createTool = (name: string, label: string) =>
  zToolApiEntity.parse({
    name,
    author: 'tester',
    label: { en_US: label },
    description: { en_US: `${label} documents` },
    parameters: [
      {
        name: 'api_key',
        label: { en_US: 'API Key' },
        human_description: { en_US: 'API key for requests' },
        type: 'string',
        form: 'form',
        required: true,
        default: 'default-key',
      },
    ],
  })

const createAgentTool = (overrides: Partial<AgentTool> = {}): AgentTool => ({
  provider_id: 'provider-1',
  provider_type: CollectionType.builtIn,
  provider_name: 'vendor/provider-1',
  tool_name: 'search',
  tool_label: 'Search Tool',
  tool_parameters: { api_key: 'original-key' },
  enabled: true,
  ...overrides,
})

const renderAgentTools = (initialTools: AgentTool[] = [createAgentTool()]) => {
  let savedConfig = createModelConfigFixture()
  const initialConfig = createModelConfigFixture({
    agentConfig: { ...savedConfig.agentConfig, tools: initialTools },
  })
  savedConfig = initialConfig
  const Caller = () => {
    const [modelConfig, setModelConfig] = useState<ModelConfig>(initialConfig)
    useEffect(() => {
      savedConfig = modelConfig
    }, [modelConfig])
    const value = useMemo(
      () => createDebugConfigurationFixture({ modelConfig, setModelConfig }),
      [modelConfig],
    )
    return (
      <ConfigContext.Provider value={value}>
        <AgentTools />
      </ConfigContext.Provider>
    )
  }
  const queryClient = createConsoleQueryClient()
  const tools = consoleQuery.workspaces.current.tools
  queryClient.setQueryData(tools.builtin.get.queryKey(), [
    createToolProviderFixture({
      id: 'provider-1',
      name: 'vendor/provider-1',
      label: { en_US: 'Search and Translate' },
      allow_delete: true,
      is_team_authorization: true,
      tools: [createTool('search', 'Search Tool'), createTool('translate', 'Translate Tool')],
    }),
  ])
  for (const operation of [tools.api.get, tools.workflow.get, tools.mcp.get])
    queryClient.setQueryData(operation.queryKey(), [])
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const view = renderWithConsoleQuery(
    <UrlState>
      <EventEmitterContextProvider>
        <Caller />
      </EventEmitterContextProvider>
    </UrlState>,
    {
      queryClient,
      systemFeatures: { enable_marketplace: false },
      workspacePermissionKeys: ['credential.use'],
    },
  )
  return { ...view, queryClient, getTools: () => savedConfig.agentConfig.tools as AgentTool[] }
}

describe('AgentTools', () => {
  it('shows enabled count and provider information', () => {
    renderAgentTools([
      createAgentTool(),
      createAgentTool({ tool_name: 'translate', tool_label: 'Translate Tool', enabled: false }),
    ])
    expect(screen.getByText(/appDebug.agent.tools.enabled/)).toHaveTextContent('1/2')
    expect(screen.getAllByText('provider-1')).toHaveLength(2)
    expect(screen.getByText('Translate Tool')).toBeInTheDocument()
  })

  it('copies the tool name from its infotip', async () => {
    const user = userEvent.setup()
    renderAgentTools()
    await user.hover(screen.getByRole('button', { name: 'search' }))
    await user.click(await screen.findByRole('button', { name: 'tools.copyToolName' }))
    expect(writeTextToClipboard).toHaveBeenCalledWith('search')
  })

  it('saves the disabled state and updates the enabled count', async () => {
    const user = userEvent.setup()
    const { getTools } = renderAgentTools()
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/appDebug.agent.tools.enabled/)).toHaveTextContent('0/1')
    expect(getTools()[0]?.enabled).toBe(false)
  })

  it('removes the tool from the configuration and list', async () => {
    const user = userEvent.setup()
    const { getTools } = renderAgentTools()
    await user.click(screen.getByRole('button', { name: 'common.operation.delete Search Tool' }))
    expect(screen.queryByText('Search Tool')).not.toBeInTheDocument()
    expect(screen.getByText(/appDebug.agent.tools.enabled/)).toHaveTextContent('0/0')
    expect(getTools()).toEqual([])
  })

  it('adds the chosen tool with its provider and parameter defaults', async () => {
    const user = userEvent.setup()
    const { getTools } = renderAgentTools([])
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    const picker = await screen.findByRole('dialog', {
      name: 'plugin.detailPanel.toolSelector.title',
    })
    await user.click(await within(picker).findByRole('button', { name: /Search and Translate/ }))
    await user.click(await within(picker).findByRole('button', { name: /Translate Tool/ }))
    expect(getTools()).toMatchObject([
      {
        provider_id: 'provider-1',
        provider_name: 'vendor/provider-1',
        tool_name: 'translate',
        tool_parameters: { api_key: 'default-key' },
        enabled: true,
        notAuthor: false,
      },
    ])
    expect(screen.getByText(/appDebug.agent.tools.enabled/)).toHaveTextContent('1/1')
  })

  it('adds all tools from the chosen provider', async () => {
    const user = userEvent.setup()
    const { getTools } = renderAgentTools([])
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    const picker = await screen.findByRole('dialog', {
      name: 'plugin.detailPanel.toolSelector.title',
    })
    const provider = await within(picker).findByRole('button', { name: /Search and Translate/ })
    await user.hover(provider)
    // Focus reveals the real add-all control before clicking it.
    const addAll = within(picker).getByRole('button', { name: 'workflow.tabs.addAll' })
    addAll.focus()
    await user.click(addAll)
    expect(getTools().map((tool) => tool.tool_name)).toEqual(['search', 'translate'])
    expect(getTools().map((tool) => tool.tool_parameters)).toEqual([
      { api_key: 'default-key' },
      { api_key: 'default-key' },
    ])
    expect(screen.getByText(/appDebug.agent.tools.enabled/)).toHaveTextContent('2/2')
  })

  it('saves settings entered in the real drawer and closes it', async () => {
    const user = userEvent.setup()
    const { getTools } = renderAgentTools([createAgentTool({ notAuthor: true })])
    await user.click(screen.getByRole('button', { name: 'tools.notAuthorized' }))
    const drawer = await screen.findByRole('dialog', { name: 'Search Tool' })
    const input = await within(drawer).findByRole('textbox', { name: /API Key/ })
    await user.clear(input)
    await user.type(input, 'updated-key')
    await user.click(within(drawer).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(getTools()[0]?.tool_parameters).toEqual({ api_key: 'updated-key' })
  })

  it('changes only the selected tool credential when tools share a provider', async () => {
    const user = userEvent.setup()
    const { getTools } = renderAgentTools([
      createAgentTool({ credential_id: 'credential-search', notAuthor: true }),
      createAgentTool({
        credential_id: 'credential-translate',
        notAuthor: true,
        tool_name: 'translate',
        tool_label: 'Translate Tool',
      }),
    ])
    await user.click(screen.getAllByRole('button', { name: 'tools.notAuthorized' })[1]!)
    const drawer = await screen.findByRole('dialog', { name: 'Translate Tool' })
    await user.click(await within(drawer).findByRole('button', { name: 'Translate credential' }))
    const menu = await screen.findByRole('dialog', { name: 'plugin.auth.authorizations' })
    await user.click(within(menu).getByText('Replacement credential'))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'plugin.auth.authorizations' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      within(drawer).getByRole('button', { name: 'Replacement credential' }),
    ).toBeInTheDocument()
    expect(getTools().map((tool) => tool.credential_id)).toEqual([
      'credential-search',
      'credential-updated',
    ])
  })
})
