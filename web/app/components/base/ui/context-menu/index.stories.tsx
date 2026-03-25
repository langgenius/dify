import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuCheckboxItemIndicator,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuGroupLabel,
  ContextMenuItem,
  ContextMenuLinkItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuRadioItemIndicator,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '.'

const TriggerArea = ({ label = 'Right-click inside this area' }: { label?: string }) => (
  <ContextMenuTrigger
    aria-label="context menu trigger area"
    render={<button type="button" className="flex h-44 w-80 select-none items-center justify-center rounded-xl border border-divider-subtle bg-background-default-subtle px-6 text-center text-sm text-text-tertiary" />}
  >
    {label}
  </ContextMenuTrigger>
)

const meta = {
  title: 'Base/Navigation/ContextMenu',
  component: ContextMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound context menu built on Base UI ContextMenu. Open by right-clicking the trigger area.',
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
      <ContextMenuContent>
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
      <ContextMenuContent>
        <ContextMenuItem>Copy</ContextMenuItem>
        <ContextMenuItem>Paste</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Share</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>Email</ContextMenuItem>
            <ContextMenuItem>Slack</ContextMenuItem>
            <ContextMenuItem>Copy link</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const WithGroupLabel: Story = {
  render: () => (
    <ContextMenu>
      <TriggerArea />
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuGroupLabel>Actions</ContextMenuGroupLabel>
          <ContextMenuItem>Rename</ContextMenuItem>
          <ContextMenuItem>Duplicate</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuGroupLabel>Danger Zone</ContextMenuGroupLabel>
          <ContextMenuItem destructive>Delete</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

const WithRadioItemsDemo = () => {
  const [value, setValue] = useState('comfortable')

  return (
    <ContextMenu>
      <TriggerArea label={`Right-click to set density: ${value}`} />
      <ContextMenuContent>
        <ContextMenuRadioGroup value={value} onValueChange={setValue}>
          <ContextMenuRadioItem value="compact">
            Compact
            <ContextMenuRadioItemIndicator />
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="comfortable">
            Comfortable
            <ContextMenuRadioItemIndicator />
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="spacious">
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

const WithCheckboxItemsDemo = () => {
  const [showToolbar, setShowToolbar] = useState(true)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showStatusBar, setShowStatusBar] = useState(true)

  return (
    <ContextMenu>
      <TriggerArea label="Right-click to configure panel visibility" />
      <ContextMenuContent>
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
      <ContextMenuContent>
        <ContextMenuLinkItem href="https://docs.dify.ai" rel="noopener noreferrer" target="_blank">
          Dify Docs
        </ContextMenuLinkItem>
        <ContextMenuLinkItem href="https://roadmap.dify.ai" rel="noopener noreferrer" target="_blank">
          Product Roadmap
        </ContextMenuLinkItem>
        <ContextMenuSeparator />
        <ContextMenuLinkItem destructive href="https://example.com/delete" rel="noopener noreferrer" target="_blank">
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
      <ContextMenuContent>
        <ContextMenuItem>
          <span aria-hidden className="i-ri-pencil-line size-4 shrink-0 text-text-tertiary" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem>
          <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <span aria-hidden className="i-ri-share-line size-4 shrink-0 text-text-tertiary" />
            Share
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>Email</ContextMenuItem>
            <ContextMenuItem>Slack</ContextMenuItem>
            <ContextMenuItem>Copy Link</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem destructive>
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}
