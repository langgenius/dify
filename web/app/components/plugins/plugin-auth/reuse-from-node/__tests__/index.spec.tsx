import type { ComponentProps, PropsWithChildren } from 'react'
import type { ReusableNode, ReuseFromNodeReference } from '../model'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import ReuseFromNode from '..'

const selectNodeLabel = 'plugin.auth.reuse.selectNode'
const locateLabel = 'plugin.auth.reuse.locateSource'

const workspaceNode: ReusableNode = {
  id: 'workspace-tool',
  title: 'Workspace tool',
  source: 'workspace',
}
const appUserNode: ReusableNode = {
  id: 'app-user-tool',
  title: 'App user tool',
  source: 'app-user',
}
const reuseNode: ReusableNode = {
  id: 'reuse-tool',
  title: 'Reuse tool',
  source: 'reuse',
}
const nodes = [workspaceNode, appUserNode, reuseNode]
const reference = (node: ReusableNode): ReuseFromNodeReference => ({
  id: node.id,
  title: node.title,
  icon: node.icon,
})

const renderReuse = (props: ComponentProps<typeof ReuseFromNode> = {}) =>
  render(<ReuseFromNode {...props} />, {
    wrapper: ({ children }: PropsWithChildren) => (
      <TooltipProvider delay={0} closeDelay={0}>
        {children}
      </TooltipProvider>
    ),
  })

describe('ReuseFromNode', () => {
  it('leaves the source unselected until the user chooses a node', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderReuse({ nodes, onChange })
    const select = screen.getByRole('combobox', { name: selectNodeLabel })
    expect(select).toHaveTextContent(selectNodeLabel)
    expect(onChange).not.toHaveBeenCalled()

    await user.click(select)

    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByRole('option', { name: /^Workspace tool/ })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(within(listbox).getByRole('option', { name: /^App user tool/ })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(select).toHaveTextContent(selectNodeLabel)
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    { node: workspaceNode, sourceName: 'plugin.auth.reuse.workspace' },
    { node: appUserNode, sourceName: 'plugin.auth.reuse.appUser' },
    { node: reuseNode, sourceName: 'plugin.auth.reuseFromNode' },
  ])(
    'selects and locates a $node.source source with its source type',
    async ({ node, sourceName }) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onLocate = vi.fn()
      const { rerender } = renderReuse({ nodes, onChange, onLocate })
      const select = screen.getByRole('combobox', { name: selectNodeLabel })
      await user.click(select)
      await user.click(await screen.findByRole('option', { name: new RegExp(`^${node.title}`) }))

      expect(onChange).toHaveBeenCalledExactlyOnceWith(node)
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
      expect(select).toHaveTextContent(selectNodeLabel)

      rerender(
        <ReuseFromNode
          nodes={nodes}
          value={reference(node)}
          onChange={onChange}
          onLocate={onLocate}
        />,
      )

      expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(node.title)
      expect(
        screen.getByText(`plugin.auth.reuse.source:${JSON.stringify({ type: sourceName })}`),
      ).toBeVisible()
      await user.click(screen.getByRole('button', { name: locateLabel }))
      expect(onLocate).toHaveBeenCalledExactlyOnceWith(node.id)
      expect(onChange).toHaveBeenCalledTimes(1)
    },
  )

  it('disables source selection when there are no candidate nodes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderReuse({ onChange })
    const select = screen.getByRole('combobox', { name: selectNodeLabel })
    expect(select).toBeDisabled()
    expect(select).toHaveTextContent(selectNodeLabel)

    await user.click(select)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: locateLabel })).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps circular references visible but prevents selecting them', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderReuse({ nodes: [workspaceNode, { ...reuseNode, disabled: true }], onChange })
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    const circularOption = await screen.findByRole('option', { name: /^Reuse tool/ })

    expect(circularOption).toHaveAttribute('aria-disabled', 'true')
    expect(within(circularOption).getByText('plugin.auth.reuseFromNode')).toBeVisible()
    await user.click(circularOption)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      selectNodeLabel,
    )

    await user.click(screen.getByRole('option', { name: /^Workspace tool/ }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(workspaceNode)
  })

  it('keeps a removed source reference when dismissed and lets the user replace it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onLocate = vi.fn()
    const removed = { id: 'removed-tool', title: 'Previously selected tool' }
    const { rerender } = renderReuse({ nodes, value: removed, onChange, onLocate })
    const select = screen.getByRole('combobox', { name: selectNodeLabel })
    expect(select).toBeEnabled()
    expect(select).toHaveTextContent(removed.title)
    expect(screen.getByText('plugin.auth.reuse.removed')).toBeVisible()
    expect(screen.queryByRole('button', { name: locateLabel })).not.toBeInTheDocument()
    await user.click(select)
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())

    expect(select).toHaveTextContent(removed.title)
    expect(screen.getByText('plugin.auth.reuse.removed')).toBeVisible()
    expect(onChange).not.toHaveBeenCalled()
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: /^App user tool/ }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(appUserNode)

    rerender(
      <ReuseFromNode
        nodes={nodes}
        value={reference(appUserNode)}
        onChange={onChange}
        onLocate={onLocate}
      />,
    )

    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toHaveTextContent(
      appUserNode.title,
    )
    expect(screen.queryByText('plugin.auth.reuse.removed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: locateLabel })).toBeEnabled()
  })

  it('preserves a removed source title while disabling selection when no replacements exist', () => {
    renderReuse({
      value: { id: 'removed-tool', title: 'Previously selected tool' },
      onLocate: vi.fn(),
    })

    const select = screen.getByRole('combobox', { name: selectNodeLabel })
    expect(select).toBeDisabled()
    expect(select).toHaveTextContent('Previously selected tool')
    expect(screen.getByText('plugin.auth.reuse.removed')).toBeVisible()
    expect(screen.queryByRole('button', { name: locateLabel })).not.toBeInTheDocument()
  })

  it('allows an expired connection to be selected and explains its expired state', async () => {
    const user = userEvent.setup()
    const expiredNode = { ...appUserNode, connectionExpired: true }
    const onChange = vi.fn()
    const { rerender } = renderReuse({ nodes: [workspaceNode, expiredNode], onChange })
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    const expiredOption = await screen.findByRole('option', { name: /^App user tool/ })
    expect(expiredOption).not.toHaveAttribute('aria-disabled', 'true')
    expect(within(expiredOption).getByText('plugin.auth.reuse.connectionExpired')).toBeVisible()
    expect(
      within(screen.getByRole('option', { name: /^Workspace tool/ })).queryByText(
        'plugin.auth.reuse.connectionExpired',
      ),
    ).not.toBeInTheDocument()
    await user.click(expiredOption)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expiredNode)

    rerender(
      <ReuseFromNode
        nodes={[workspaceNode, expiredNode]}
        value={reference(expiredNode)}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('combobox', { name: selectNodeLabel })).toBeEnabled()
    await user.click(screen.getByRole('combobox', { name: selectNodeLabel }))
    const selectedOption = await screen.findByRole('option', { name: /^App user tool/ })
    expect(selectedOption).toHaveAttribute('aria-selected', 'true')
    expect(within(selectedOption).getByText('plugin.auth.reuse.connectionExpired')).toBeVisible()
  })
})
