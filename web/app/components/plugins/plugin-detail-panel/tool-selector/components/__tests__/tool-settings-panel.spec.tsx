import type { ToolWithProvider } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ToolSettingsPanel from '../tool-settings-panel'

vi.mock('@/app/components/base/tab-slider-plain', () => ({
  default: ({
    options,
    onChange,
  }: {
    options: Array<{ value: string, text: string }>
    onChange: (value: string) => void
  }) => (
    <div data-testid="tab-slider">
      {options.map(option => (
        <button key={option.value} onClick={() => onChange(option.value)}>{option.text}</button>
      ))}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/tool/components/tool-form', () => ({
  default: ({ schema }: { schema: Array<{ name: string }> }) => <div data-testid="tool-form">{schema.map(item => item.name).join(',')}</div>,
}))

vi.mock('../reasoning-config-form', () => ({
  default: ({ schemas }: { schemas: Array<{ name: string }> }) => <div data-testid="reasoning-config-form">{schemas.map(item => item.name).join(',')}</div>,
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

    rerender(
      <ToolSettingsPanel
        {...baseProps}
        settingsFormSchemas={[]}
        paramsFormSchemas={[]}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the settings form and lets the tab slider switch to params', () => {
    const onCurrTypeChange = vi.fn()
    render(
      <ToolSettingsPanel
        {...baseProps}
        onCurrTypeChange={onCurrTypeChange}
      />,
    )

    expect(screen.getByTestId('tool-form')).toHaveTextContent('api_key')
    fireEvent.click(screen.getByText('plugin.detailPanel.toolSelector.params'))

    expect(onCurrTypeChange).toHaveBeenCalledWith('params')
  })

  it('renders params tips and the reasoning config form for params-only views', () => {
    render(
      <ToolSettingsPanel
        {...baseProps}
        currType="params"
        settingsFormSchemas={[]}
        userSettingsOnly={false}
        reasoningConfigOnly
      />,
    )

    expect(screen.getAllByText('plugin.detailPanel.toolSelector.paramsTip1')).toHaveLength(2)
    expect(screen.getByTestId('reasoning-config-form')).toHaveTextContent('temperature')
  })
})
