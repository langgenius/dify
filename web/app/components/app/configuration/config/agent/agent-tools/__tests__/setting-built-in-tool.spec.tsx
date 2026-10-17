import type { Tool, ToolParameter } from '@/app/components/tools/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { CollectionType } from '@/app/components/tools/types'
import SettingBuiltInTool from '../setting-built-in-tool'

const fetchBuiltInToolList = vi.fn()
const fetchCustomToolList = vi.fn()
const fetchWorkflowToolList = vi.fn()
vi.mock('@/service/tools', () => ({
  fetchBuiltInToolList: (collectionName: string) => fetchBuiltInToolList(collectionName),
  fetchCustomToolList: (collectionName: string) => fetchCustomToolList(collectionName),
  fetchWorkflowToolList: (appId: string) => fetchWorkflowToolList(appId),
}))

let pluginAuthClickValue = 'credential-from-plugin'
vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AuthCategory: { tool: 'tool' },
  PluginAuthInAgent: (props: { onAuthorizationItemClick?: (id: string) => void }) => (
    <div data-testid="plugin-auth">
      <button type="button" onClick={() => props.onAuthorizationItemClick?.(pluginAuthClickValue)}>
        choose-plugin-credential
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/readme-panel/entrance', () => ({
  ReadmeEntrance: ({ className }: { className?: string }) => (
    <div className={className}>readme</div>
  ),
}))

const createParameter = (overrides?: Partial<ToolParameter>): ToolParameter => ({
  name: 'settingParam',
  label: {
    en_US: 'Setting Param',
    zh_Hans: 'Setting Param',
  },
  human_description: {
    en_US: 'Setting description',
    zh_Hans: 'Setting description',
  },
  type: 'string',
  form: 'config',
  llm_description: '',
  required: true,
  multiple: false,
  default: '',
  ...overrides,
})

const createTool = (overrides?: Partial<Tool>): Tool => ({
  name: 'search',
  author: 'tester',
  label: {
    en_US: 'Search Tool',
    zh_Hans: 'Search Tool',
  },
  description: {
    en_US: 'tool description',
    zh_Hans: 'tool description',
  },
  parameters: [
    createParameter({
      name: 'infoParam',
      label: {
        en_US: 'Info Param',
        zh_Hans: 'Info Param',
      },
      human_description: {
        en_US: 'Info description',
        zh_Hans: 'Info description',
      },
      form: 'llm',
      required: false,
    }),
    createParameter(),
  ],
  labels: [],
  output_schema: {},
  ...overrides,
})

const baseCollection = {
  id: 'provider-1',
  name: 'vendor/provider-1',
  author: 'tester',
  description: {
    en_US: 'desc',
    zh_Hans: 'desc',
  },
  icon: 'https://example.com/icon.png',
  label: {
    en_US: 'Provider Label',
    zh_Hans: 'Provider Label',
  },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: true,
  labels: [],
  tools: [createTool()],
}

const renderComponent = (props?: Partial<React.ComponentProps<typeof SettingBuiltInTool>>) => {
  const onHide = vi.fn()
  const onSave = vi.fn()
  const onAuthorizationItemClick = vi.fn()
  const utils = render(
    <SettingBuiltInTool
      collection={baseCollection}
      toolName="search"
      setting={{ settingParam: 'value' }}
      onHide={onHide}
      onSave={onSave}
      onAuthorizationItemClick={onAuthorizationItemClick}
      {...props}
    />,
  )
  return {
    ...utils,
    onHide,
    onSave,
    onAuthorizationItemClick,
  }
}

describe('SettingBuiltInTool', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    pluginAuthClickValue = 'credential-from-plugin'
  })

  it('should fetch tool list when collection has no tools', async () => {
    fetchBuiltInToolList.mockResolvedValueOnce([createTool()])
    renderComponent({
      collection: {
        ...baseCollection,
        tools: [],
      },
    })

    await waitFor(() => {
      expect(fetchBuiltInToolList).toHaveBeenCalledTimes(1)
      expect(fetchBuiltInToolList).toHaveBeenCalledWith('vendor/provider-1')
    })
    expect(await screen.findByText('Search Tool')).toBeInTheDocument()
  })

  it('preserves the settings draft when switching named tab panels', async () => {
    const user = userEvent.setup()
    renderComponent()
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Setting Param/ })).toBeInTheDocument()
    })

    const settingInput = screen.getByRole('textbox', { name: /Setting Param/ })
    await user.clear(settingInput)
    await user.type(settingInput, 'unsaved draft')
    await user.click(screen.getByRole('tab', { name: 'tools.setBuiltInTools.parameters' }))
    expect(
      screen.getByRole('tabpanel', { name: 'tools.setBuiltInTools.parameters' }),
    ).toHaveTextContent('Info Param')
    expect(screen.queryByRole('textbox', { name: /Setting Param/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'tools.setBuiltInTools.setting' }))
    expect(screen.getByRole('textbox', { name: /Setting Param/ })).toHaveValue('unsaved draft')
    expect(screen.getByRole('dialog', { name: 'Search Tool' })).toBeInTheDocument()
  })

  it('should keep the setting tab hidden when readonly by default', async () => {
    renderComponent({ readonly: true })

    expect(await screen.findByText('Info Param')).toBeInTheDocument()
    expect(screen.queryByText('tools.setBuiltInTools.setting')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  })

  it('should expose readonly setting details when explicitly enabled', async () => {
    const user = userEvent.setup()
    renderComponent({ readonly: true, showReadOnlySettingDetails: true })

    expect(await screen.findByText('Info Param')).toBeInTheDocument()
    await user.click(screen.getByText('tools.setBuiltInTools.setting'))

    expect(screen.getByText('Setting Param')).toBeInTheDocument()
    expect(screen.getByText('tools.setBuiltInTools.string')).toBeInTheDocument()
    expect(screen.getByText('Setting description')).toBeInTheDocument()
    expect(screen.queryByText('Info Param')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Setting Param/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
  })

  it('should call onSave with updated values when save button clicked', async () => {
    const { onSave } = renderComponent()
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Setting Param/ })).toBeInTheDocument(),
    )
    const user = userEvent.setup()
    const settingInput = screen.getByRole('textbox', { name: /Setting Param/ })
    await user.clear(settingInput)
    await user.type(settingInput, 'updated')
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ settingParam: 'updated' }))
  })

  it('should keep save disabled until required field provided', async () => {
    renderComponent({
      setting: {},
    })
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Setting Param/ })).toBeInTheDocument(),
    )
    const saveButton = screen.getByRole('button', { name: 'common.operation.save' })
    expect(saveButton).toBeDisabled()
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: /Setting Param/ }), 'filled')
    expect(saveButton).not.toBeDisabled()
  })

  it('should call onHide when cancel button is pressed', async () => {
    const { onHide } = renderComponent()
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Setting Param/ })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onHide).toHaveBeenCalled()
  })

  it('should trigger authorization callback from plugin auth section', async () => {
    const { onAuthorizationItemClick } = renderComponent()
    await userEvent.click(screen.getByRole('button', { name: 'choose-plugin-credential' }))
    expect(onAuthorizationItemClick).toHaveBeenCalledWith('credential-from-plugin')
  })

  it('should call onHide when back button is clicked', async () => {
    const { onHide } = renderComponent({
      showBackButton: true,
    })
    await userEvent.click(screen.getByText('plugin.detailPanel.operation.back'))
    expect(onHide).toHaveBeenCalled()
  })

  it('should load workflow tools when workflow collection is provided', async () => {
    fetchWorkflowToolList.mockResolvedValueOnce([
      createTool({
        name: 'workflow-tool',
      }),
    ])
    renderComponent({
      collection: {
        ...baseCollection,
        type: CollectionType.workflow,
        tools: [],
        id: 'workflow-1',
      },
      isBuiltIn: false,
    })

    await waitFor(() => {
      expect(fetchWorkflowToolList).toHaveBeenCalledWith('workflow-1')
    })
  })
})
