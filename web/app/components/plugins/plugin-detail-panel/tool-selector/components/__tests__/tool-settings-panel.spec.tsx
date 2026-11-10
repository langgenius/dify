import type { ReactElement } from 'react'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { ToolSettingsPanel } from '../tool-settings-panel'

const createSchema = (overrides: Partial<ToolFormSchema> = {}): ToolFormSchema => ({
  name: 'api_key',
  variable: 'api_key',
  label: { en_US: 'API key', zh_Hans: 'API 密钥' },
  type: FormTypeEnum.textInput,
  _type: 'string',
  form: 'form',
  required: false,
  default: '',
  tooltip: { en_US: 'Credential used by the tool', zh_Hans: '工具使用的凭据' },
  show_on: [],
  options: [],
  placeholder: { en_US: 'Enter API key', zh_Hans: '输入 API 密钥' },
  ...overrides,
})

const settingsSchema = createSchema()
const paramsSchema = createSchema({
  name: 'temperature',
  variable: 'temperature',
  label: { en_US: 'Temperature', zh_Hans: '温度' },
  type: FormTypeEnum.textNumber,
  _type: 'number',
  form: 'llm',
  default: '0.5',
  tooltip: { en_US: 'Controls randomness', zh_Hans: '控制随机性' },
  placeholder: { en_US: 'Enter temperature', zh_Hans: '输入温度' },
})

const baseProps = {
  nodeId: 'node-1',
  currType: 'settings' as const,
  settingsFormSchemas: [settingsSchema],
  paramsFormSchemas: [paramsSchema],
  settingsValue: {
    api_key: { type: VarKindType.mixed, value: 'saved-key' },
  },
  value: {
    provider_name: 'test-provider',
    tool_name: 'test-tool',
    tool_label: 'Test tool',
    parameters: {
      temperature: {
        auto: 0 as const,
        value: { type: VarKindType.constant, value: '0.7' },
      },
    },
  },
  showTabSlider: true,
  userSettingsOnly: false,
  reasoningConfigOnly: false,
  nodeOutputVars: [],
  availableNodes: [],
  onCurrTypeChange: vi.fn(),
  onSettingsFormChange: vi.fn(),
  onParamsFormChange: vi.fn(),
  currentProvider: {
    is_team_authorization: true,
  } as ToolWithProvider,
}

function renderPanel(ui: ReactElement) {
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient, [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderWorkflowFlowComponent(ui, {
    queryClient,
    nodes: [createNode({ id: 'node-1', data: { type: BlockEnum.Tool, title: 'Tool' } })],
    edges: [],
  })
}

describe('ToolSettingsPanel', () => {
  it('returns null when the provider is not team-authorized or has no forms', () => {
    const { rerender } = renderPanel(
      <ToolSettingsPanel
        {...baseProps}
        currentProvider={{ is_team_authorization: false } as ToolWithProvider}
      />,
    )

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()

    rerender(<ToolSettingsPanel {...baseProps} settingsFormSchemas={[]} paramsFormSchemas={[]} />)

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('switches the controlled settings and params panels with the keyboard', async () => {
    const user = userEvent.setup()
    function ControlledPanel() {
      const [currType, setCurrType] = useState<'settings' | 'params'>('settings')
      return <ToolSettingsPanel {...baseProps} currType={currType} onCurrTypeChange={setCurrType} />
    }
    renderPanel(<ControlledPanel />)

    expect(screen.getByRole('textbox')).toHaveTextContent('saved-key')
    await user.click(screen.getByRole('tab', { name: 'plugin.detailPanel.toolSelector.settings' }))
    await user.keyboard('{ArrowRight}{Enter}')
    expect(
      screen.getByRole('tab', { name: 'plugin.detailPanel.toolSelector.params' }),
    ).toHaveFocus()
    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveValue(0.7)
    expect(screen.queryByText('saved-key')).not.toBeInTheDocument()
    await user.keyboard('{ArrowLeft}{Enter}')
    expect(screen.getByRole('textbox')).toHaveTextContent('saved-key')
  })

  it('renders a settings-only real form without an orphaned tab panel', () => {
    renderPanel(
      <ToolSettingsPanel
        {...baseProps}
        paramsFormSchemas={[]}
        showTabSlider={false}
        userSettingsOnly
      />,
    )

    const input = screen.getByRole('textbox')
    expect(input).toHaveTextContent('saved-key')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  })

  it('renders params tips and a real reasoning control without orphaned panels', () => {
    renderPanel(
      <ToolSettingsPanel
        {...baseProps}
        currType="params"
        settingsFormSchemas={[]}
        userSettingsOnly={false}
        reasoningConfigOnly
        showTabSlider={false}
      />,
    )

    expect(screen.getByText('plugin.detailPanel.toolSelector.paramsTip1')).toBeInTheDocument()
    expect(screen.getByText('plugin.detailPanel.toolSelector.paramsTip2')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveValue(0.7)
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  })
})
