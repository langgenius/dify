import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import StatusIndicators from './status-indicators'

let installedPlugins = [{ name: 'demo-plugin', plugin_unique_identifier: 'demo@1.0.0' }]

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({ data: { plugins: installedPlugins } }),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ popupContent }: { popupContent: React.ReactNode }) => <div>{popupContent}</div>,
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

  it('should render warning states when provider model is disabled', () => {
    const parentClick = vi.fn()
    const { rerender } = render(
      <div onClick={parentClick}>
        <StatusIndicators
          needsConfiguration={false}
          modelProvider={true}
          inModelList={true}
          disabled={true}
          pluginInfo={null}
          t={t}
        />
      </div>,
    )
    expect(screen.getByText('nodes.agent.modelSelectorTooltips.deprecated')).toBeInTheDocument()

    rerender(
      <div onClick={parentClick}>
        <StatusIndicators
          needsConfiguration={false}
          modelProvider={true}
          inModelList={false}
          disabled={true}
          pluginInfo={null}
          t={t}
        />
      </div>,
    )
    expect(screen.getByText('nodes.agent.modelNotSupport.title')).toBeInTheDocument()
    expect(screen.getByText('nodes.agent.linkToPlugin').closest('a')).toHaveAttribute('href', '/plugins')
    fireEvent.click(screen.getByText('nodes.agent.modelNotSupport.title'))
    fireEvent.click(screen.getByText('nodes.agent.linkToPlugin'))
    expect(parentClick).not.toHaveBeenCalled()

    rerender(
      <div onClick={parentClick}>
        <StatusIndicators
          needsConfiguration={false}
          modelProvider={true}
          inModelList={false}
          disabled={true}
          pluginInfo={{ name: 'demo-plugin' }}
          t={t}
        />
      </div>,
    )
    expect(screen.getByText('SwitchVersion:demo@1.0.0')).toBeInTheDocument()
  })

  it('should render marketplace warning when provider is unavailable', () => {
    render(
      <StatusIndicators
        needsConfiguration={false}
        modelProvider={false}
        inModelList={false}
        disabled={false}
        pluginInfo={null}
        t={t}
      />,
    )
    expect(screen.getByText('nodes.agent.modelNotInMarketplace.title')).toBeInTheDocument()
  })
})
