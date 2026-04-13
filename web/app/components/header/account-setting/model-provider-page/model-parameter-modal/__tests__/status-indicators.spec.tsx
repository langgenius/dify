import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import StatusIndicators from '../status-indicators'

let installedPlugins = [{ name: 'demo-plugin', plugin_unique_identifier: 'demo@1.0.0' }]

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({ data: { plugins: installedPlugins } }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/switch-plugin-version', () => ({
  SwitchPluginVersion: ({ uniqueIdentifier }: { uniqueIdentifier: string }) => <div>{`SwitchVersion:${uniqueIdentifier}`}</div>,
}))

const t = (key: string) => key

describe('StatusIndicators', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installedPlugins = [{ name: 'demo-plugin', plugin_unique_identifier: 'demo@1.0.0' }]
  })

  it('should render nothing when model is available and enabled', () => {
    const { container } = render(
      <StatusIndicators
        needsConfiguration={false}
        modelProvider={true}
        inModelList={true}
        disabled={false}
        pluginInfo={null}
        t={t}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('should render deprecated tooltip when provider model is disabled and in model list', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StatusIndicators
        needsConfiguration={false}
        modelProvider={true}
        inModelList={true}
        disabled={true}
        pluginInfo={null}
        t={t}
      />,
    )

    const trigger = container.querySelector('[data-state]')
    expect(trigger).toBeInTheDocument()
    await user.hover(trigger as HTMLElement)

    expect(await screen.findByText('nodes.agent.modelSelectorTooltips.deprecated')).toBeInTheDocument()
  })

  it('should render model-not-support tooltip when disabled model is not in model list and has no pluginInfo', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StatusIndicators
        needsConfiguration={false}
        modelProvider={true}
        inModelList={false}
        disabled={true}
        pluginInfo={null}
        t={t}
      />,
    )

    const trigger = container.querySelector('[data-state]')
    expect(trigger).toBeInTheDocument()
    await user.hover(trigger as HTMLElement)

    expect(await screen.findByText('nodes.agent.modelNotSupport.title')).toBeInTheDocument()
  })

  it('should render switch plugin version when pluginInfo exists for disabled unsupported model', () => {
    render(
      <StatusIndicators
        needsConfiguration={false}
        modelProvider={true}
        inModelList={false}
        disabled={true}
        pluginInfo={{ name: 'demo-plugin' }}
        t={t}
      />,
    )

    expect(screen.getByText('SwitchVersion:demo@1.0.0')).toBeInTheDocument()
  })

  it('should render nothing when needsConfiguration is true even with disabled and modelProvider', () => {
    const { container } = render(
      <StatusIndicators
        needsConfiguration={true}
        modelProvider={true}
        inModelList={true}
        disabled={true}
        pluginInfo={null}
        t={t}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('should render SwitchVersion with empty identifier when plugin is not in installed list', () => {
    installedPlugins = []

    render(
      <StatusIndicators
        needsConfiguration={false}
        modelProvider={true}
        inModelList={false}
        disabled={true}
        pluginInfo={{ name: 'missing-plugin' }}
        t={t}
      />,
    )

    expect(screen.getByText('SwitchVersion:')).toBeInTheDocument()
  })

  it('should render marketplace warning tooltip when provider is unavailable', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <StatusIndicators
        needsConfiguration={false}
        modelProvider={false}
        inModelList={false}
        disabled={false}
        pluginInfo={null}
        t={t}
      />,
    )

    const trigger = container.querySelector('[data-state]')
    expect(trigger).toBeInTheDocument()
    await user.hover(trigger as HTMLElement)

    expect(await screen.findByText('nodes.agent.modelNotInMarketplace.title')).toBeInTheDocument()
  })
})
