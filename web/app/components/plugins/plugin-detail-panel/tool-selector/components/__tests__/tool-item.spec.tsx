import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ToolItem from '../tool-item'

let mcpAllowed = true

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({
    allowed: mcpAllowed,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-not-support-tooltip', () => ({
  default: () => <div data-testid="mcp-tooltip">mcp unavailable</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/install-plugin-button', () => ({
  InstallPluginButton: ({ onSuccess }: { onSuccess: () => void }) => (
    <button onClick={onSuccess}>install plugin</button>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/switch-plugin-version', () => ({
  SwitchPluginVersion: ({ onChange }: { onChange: () => void }) => (
    <button onClick={onChange}>switch version</button>
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({
    children,
    popupContent,
  }: {
    children: React.ReactNode
    popupContent: React.ReactNode
  }) => (
    <div>
      {children}
      <div>{popupContent}</div>
    </div>
  ),
}))

describe('ToolItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mcpAllowed = true
  })

  it('shows auth status actions for no-auth and auth-removed states', () => {
    const { rerender } = render(
      <ToolItem
        open={false}
        toolLabel="Search Tool"
        providerName="acme/search"
        noAuth
      />,
    )

    expect(screen.getByText('tools.notAuthorized')).toBeInTheDocument()

    rerender(
      <ToolItem
        open={false}
        toolLabel="Search Tool"
        providerName="acme/search"
        authRemoved
      />,
    )

    expect(screen.getByText('plugin.auth.authRemoved')).toBeInTheDocument()
  })

  it('surfaces install and version mismatch recovery actions', () => {
    const onInstall = vi.fn()
    const { rerender } = render(
      <ToolItem
        open={false}
        toolLabel="Search Tool"
        providerName="acme/search"
        uninstalled
        installInfo="plugin@2.0.0"
        onInstall={onInstall}
      />,
    )

    fireEvent.click(screen.getByText('install plugin'))
    expect(onInstall).toHaveBeenCalledTimes(1)

    rerender(
      <ToolItem
        open={false}
        toolLabel="Search Tool"
        providerName="acme/search"
        versionMismatch
        installInfo="plugin@2.0.0"
        onInstall={onInstall}
      />,
    )

    fireEvent.click(screen.getByText('switch version'))
    expect(onInstall).toHaveBeenCalledTimes(2)
  })

  it('blocks unsupported MCP tools and still exposes error state', () => {
    mcpAllowed = false
    const { rerender } = render(
      <ToolItem
        open={false}
        toolLabel="Search Tool"
        providerName="acme/search"
        isMCPTool
      />,
    )

    expect(screen.getByTestId('mcp-tooltip')).toBeInTheDocument()

    rerender(
      <ToolItem
        open={false}
        toolLabel="Search Tool"
        providerName="acme/search"
        isError
        errorTip="tool failed"
      />,
    )

    expect(screen.getByText('tool failed')).toBeInTheDocument()
  })
})
