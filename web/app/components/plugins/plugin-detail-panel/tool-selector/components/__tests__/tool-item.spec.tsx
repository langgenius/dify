import type { ReactElement } from 'react'
import { Popover } from '@langgenius/dify-ui/popover'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolItem } from '../tool-item'

const renderToolItem = (item: ReactElement) => {
  const view = render(<Popover>{item}</Popover>)
  return {
    ...view,
    rerenderToolItem: (nextItem: ReactElement) => view.rerender(<Popover>{nextItem}</Popover>),
  }
}

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

describe('ToolItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mcpAllowed = true
  })

  it('shows auth status actions for no-auth and auth-removed states', () => {
    const { rerenderToolItem } = renderToolItem(
      <ToolItem open={false} toolLabel="Search Tool" providerName="acme/search" noAuth />,
    )

    expect(screen.getByText('tools.notAuthorized')).toBeInTheDocument()

    rerenderToolItem(
      <ToolItem open={false} toolLabel="Search Tool" providerName="acme/search" authRemoved />,
    )

    expect(screen.getByText('plugin.auth.authRemoved')).toBeInTheDocument()
  })

  it('surfaces install and version mismatch recovery actions', () => {
    const onInstall = vi.fn()
    const { rerenderToolItem } = renderToolItem(
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

    rerenderToolItem(
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

  it('blocks unsupported MCP tools and still exposes error state', async () => {
    mcpAllowed = false
    const { rerenderToolItem } = renderToolItem(
      <ToolItem open={false} toolLabel="Search Tool" providerName="acme/search" isMCPTool />,
    )

    expect(screen.getByTestId('mcp-tooltip')).toBeInTheDocument()

    rerenderToolItem(
      <ToolItem
        open={false}
        toolLabel="Search Tool"
        providerName="acme/search"
        isError
        errorTip="tool failed"
      />,
    )

    await userEvent.hover(screen.getByLabelText('tool failed'))
    expect(await screen.findByText('tool failed')).toBeInTheDocument()
  })

  it('exposes one primary row action followed by a separate delete action', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    renderToolItem(
      <ToolItem
        open={false}
        triggerLabel="Configure Search Tool"
        toolLabel="Search Tool"
        providerName="acme/search"
        onDelete={onDelete}
      />,
    )

    const primaryAction = screen.getByRole('button', { name: 'Configure Search Tool' })
    const deleteAction = screen.getByRole('button', { name: 'common.operation.delete' })
    expect(primaryAction).not.toContainElement(deleteAction)

    await user.tab()
    expect(primaryAction).toHaveFocus()
    await user.tab()
    expect(deleteAction).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
