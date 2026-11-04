import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuCheckboxItemIndicator,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuGroupLabel,
  ContextMenuItem,
  ContextMenuLinkItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuRadioItemIndicator,
  ContextMenuSeparator,
  ContextMenuSubmenu,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
} from '.'

function TriggerArea({ label = 'Right-click inside this area' }: { label?: string }) {
  return (
    <ContextMenuTrigger
      aria-label="context menu trigger area"
      className="flex h-44 w-80 items-center justify-center rounded-xl border border-divider-subtle bg-background-default-subtle px-6 text-center text-sm text-text-tertiary select-none"
    >
      {label}
    </ContextMenuTrigger>
  )
}

const meta = {
  title: 'Base/UI/ContextMenu',
  component: ContextMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound context menu built on Base UI ContextMenu. Open by right-clicking the trigger area.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ContextMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ContextMenu>
      <TriggerArea />
      <ContextMenuContent className="w-36">
        <ContextMenuItem>Edit</ContextMenuItem>
        <ContextMenuItem>Duplicate</ContextMenuItem>
        <ContextMenuItem>Archive</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const WithSubmenu: Story = {
  render: () => (
    <ContextMenu>
      <TriggerArea />
      <ContextMenuContent className="w-36">
        <ContextMenuItem>Copy</ContextMenuItem>
        <ContextMenuItem>Paste</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSubmenu>
          <ContextMenuSubmenuTrigger>Share</ContextMenuSubmenuTrigger>
          <ContextMenuContent className="w-36">
            <ContextMenuItem>Email</ContextMenuItem>
            <ContextMenuItem>Slack</ContextMenuItem>
            <ContextMenuItem>Copy link</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuSubmenu>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const WithGroupLabel: Story = {
  render: () => (
    <ContextMenu>
      <TriggerArea />
      <ContextMenuContent className="w-44">
        <ContextMenuGroup>
          <ContextMenuGroupLabel>Actions</ContextMenuGroupLabel>
          <ContextMenuItem>Rename</ContextMenuItem>
          <ContextMenuItem>Duplicate</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuGroupLabel>Danger Zone</ContextMenuGroupLabel>
          <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

type Density = 'compact' | 'comfortable' | 'spacious'

function WithRadioItemsDemo() {
  const [density, setDensity] = React.useState<Density>('comfortable')

  return (
    <ContextMenu>
      <TriggerArea label={`Right-click to set density: ${density}`} />
      <ContextMenuContent className="w-44">
        <ContextMenuRadioGroup<Density> value={density} onValueChange={setDensity}>
          <ContextMenuRadioItem<Density> value="compact">
            Compact
            <ContextMenuRadioItemIndicator />
          </ContextMenuRadioItem>
          <ContextMenuRadioItem<Density> value="comfortable">
            Comfortable
            <ContextMenuRadioItemIndicator />
          </ContextMenuRadioItem>
          <ContextMenuRadioItem<Density> value="spacious">
            Spacious
            <ContextMenuRadioItemIndicator />
          </ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const WithRadioItems: Story = {
  render: () => <WithRadioItemsDemo />,
}

function WithCheckboxItemsDemo() {
  const [showToolbar, setShowToolbar] = React.useState(true)
  const [showSidebar, setShowSidebar] = React.useState(false)
  const [showStatusBar, setShowStatusBar] = React.useState(true)

  return (
    <ContextMenu>
      <TriggerArea label="Right-click to configure panel visibility" />
      <ContextMenuContent className="w-44">
        <ContextMenuCheckboxItem checked={showToolbar} onCheckedChange={setShowToolbar}>
          Toolbar
          <ContextMenuCheckboxItemIndicator />
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={showSidebar} onCheckedChange={setShowSidebar}>
          Sidebar
          <ContextMenuCheckboxItemIndicator />
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={showStatusBar} onCheckedChange={setShowStatusBar}>
          Status bar
          <ContextMenuCheckboxItemIndicator />
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const WithCheckboxItems: Story = {
  render: () => <WithCheckboxItemsDemo />,
}

export const WithLinkItems: Story = {
  render: () => (
    <ContextMenu>
      <TriggerArea label="Right-click to open links" />
      <ContextMenuContent className="w-56">
        <ContextMenuLinkItem href="https://docs.dify.ai" rel="noopener noreferrer" target="_blank">
          Dify Docs
        </ContextMenuLinkItem>
        <ContextMenuLinkItem
          href="https://roadmap.dify.ai"
          rel="noopener noreferrer"
          target="_blank"
        >
          Product Roadmap
        </ContextMenuLinkItem>
        <ContextMenuSeparator />
        <ContextMenuLinkItem
          variant="destructive"
          href="https://example.com/delete"
          rel="noopener noreferrer"
          target="_blank"
        >
          Dangerous External Action
        </ContextMenuLinkItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const Complex: Story = {
  render: () => (
    <ContextMenu>
      <TriggerArea label="Right-click to inspect all menu capabilities" />
      <ContextMenuContent className="w-44">
        <ContextMenuItem>
          <span aria-hidden className="i-ri-pencil-line size-4 shrink-0 text-text-tertiary" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem>
          <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSubmenu>
          <ContextMenuSubmenuTrigger>
            <span aria-hidden className="i-ri-share-line size-4 shrink-0 text-text-tertiary" />
            Share
          </ContextMenuSubmenuTrigger>
          <ContextMenuContent className="w-36">
            <ContextMenuItem>Email</ContextMenuItem>
            <ContextMenuItem>Slack</ContextMenuItem>
            <ContextMenuItem>Copy Link</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuSubmenu>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

function ExplicitAnatomyDemo() {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const [action, setAction] = React.useState('No action selected')

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger
          ref={anchorRef}
          tabIndex={0}
          className="rounded-xl border border-divider-subtle p-6"
        >
          Right-click for anchored actions
        </ContextMenuTrigger>
        <ContextMenuPortal container={containerRef}>
          <ContextMenuPositioner anchor={anchorRef} side="bottom" align="start" sideOffset={8}>
            <ContextMenuPopup
              aria-label="Anchored actions"
              className="min-w-40 scroll-py-1 rounded-lg border border-divider-subtle bg-background-default py-1 shadow-md"
            >
              <ContextMenuSubmenu>
                <ContextMenuSubmenuTrigger>Share</ContextMenuSubmenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => setAction('Link copied')}>
                    Copy link
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenuSubmenu>
            </ContextMenuPopup>
          </ContextMenuPositioner>
        </ContextMenuPortal>
      </ContextMenu>
      <div ref={containerRef} role="region" aria-label="Menu portal" />
      <p role="status">{action}</p>
    </div>
  )
}

export const ExplicitAnatomy: Story = {
  render: () => <ExplicitAnatomyDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByText('Right-click for anchored actions')
    trigger.focus()
    await userEvent.pointer({ target: trigger, keys: '[MouseRight]' })
    const popup = await within(canvas.getByRole('region', { name: 'Menu portal' })).findByRole(
      'menu',
      { name: 'Anchored actions' },
    )
    await waitFor(() =>
      expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        trigger.getBoundingClientRect().bottom + 7,
      ),
    )
    // A pointer open focuses the role="menu" element in a deferred animation frame; list
    // navigation only handles ArrowDown once that focus lands.
    await waitFor(() => expect(popup).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(body.getByRole('menuitem', { name: 'Share' })).toHaveFocus())
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(body.getByRole('menuitem', { name: 'Copy link' })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Link copied'))
    await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument())
    await expect(trigger).toHaveFocus()
  },
}
