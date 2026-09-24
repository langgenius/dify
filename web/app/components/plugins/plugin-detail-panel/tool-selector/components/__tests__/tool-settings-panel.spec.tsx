import type { ToolWithProvider } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { ToolSettingsPanel } from '../tool-settings-panel'

vi.mock('@/app/components/workflow/nodes/tool/components/tool-form', () => ({
  default: ({ schema }: { schema: Array<{ name: string }> }) => (
    <div data-testid="tool-form">{schema.map((item) => item.name).join(',')}</div>
  ),
}))

vi.mock('../reasoning-config-form', () => ({
  default: ({ schemas }: { schemas: Array<{ name: string }> }) => (
    <div data-testid="reasoning-config-form">{schemas.map((item) => item.name).join(',')}</div>
  ),
}))

const baseProps = {
  nodeId: 'node-1',
  currType: 'settings' as const,
  settingsFormSchemas: [{ name: 'api_key' }] as never[],
  paramsFormSchemas: [{ name: 'temperature' }] as never[],
  settingsValue: {},
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

describe('ToolSettingsPanel', () => {
  it('returns null when the provider is not team-authorized or has no forms', () => {
    const { container, rerender } = render(
      <ToolSettingsPanel
        {...baseProps}
        currentProvider={{ is_team_authorization: false } as ToolWithProvider}
      />,
    )

    expect(container).toBeEmptyDOMElement()

    rerender(<ToolSettingsPanel {...baseProps} settingsFormSchemas={[]} paramsFormSchemas={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('switches the controlled settings and params panels with the keyboard', async () => {
    const user = userEvent.setup()
    function ControlledPanel() {
      const [currType, setCurrType] = useState<'settings' | 'params'>('settings')
      return <ToolSettingsPanel {...baseProps} currType={currType} onCurrTypeChange={setCurrType} />
    }
    render(<ControlledPanel />)

    expect(
      screen.getByRole('tabpanel', { name: 'plugin.detailPanel.toolSelector.settings' }),
    ).toHaveTextContent('api_key')
    await user.click(screen.getByRole('tab', { name: 'plugin.detailPanel.toolSelector.settings' }))
    await user.keyboard('{ArrowRight}{Enter}')
    expect(
      screen.getByRole('tab', { name: 'plugin.detailPanel.toolSelector.params' }),
    ).toHaveFocus()
    expect(
      screen.getByRole('tabpanel', { name: 'plugin.detailPanel.toolSelector.params' }),
    ).toHaveTextContent('temperature')
    expect(screen.queryByTestId('tool-form')).not.toBeInTheDocument()
    await user.keyboard('{ArrowLeft}{Enter}')
    expect(
      screen.getByRole('tabpanel', { name: 'plugin.detailPanel.toolSelector.settings' }),
    ).toHaveTextContent('api_key')
  })

  it('renders a settings-only form without an orphaned tab panel', () => {
    render(
      <ToolSettingsPanel
        {...baseProps}
        paramsFormSchemas={[]}
        showTabSlider={false}
        userSettingsOnly
      />,
    )
    expect(screen.getByTestId('tool-form')).toHaveTextContent('api_key')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  })

  it('renders params tips and the reasoning config form for params-only views', () => {
    render(
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
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    expect(screen.getByTestId('reasoning-config-form')).toHaveTextContent('temperature')
  })
})
