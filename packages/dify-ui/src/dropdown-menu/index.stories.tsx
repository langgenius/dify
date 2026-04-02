import type { Meta, StoryObj } from '@storybook/react'
import {
  RiArchiveLine,
  RiChat1Line,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiLink,
  RiLockLine,
  RiMailLine,
  RiPencilLine,
  RiShareLine,
} from '@remixicon/react'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemIndicator,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './index'

const TriggerButton = ({ label = 'Open Menu' }: { label?: string }) => (
  <DropdownMenuTrigger
    render={<button type="button" className="rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover" />}
  >
    {label}
  </DropdownMenuTrigger>
)

const meta = {
  title: 'Base/Navigation/DropdownMenu',
  component: DropdownMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound dropdown menu built on Base UI Menu. Supports items, separators, group labels, submenus, radio groups, checkbox items, destructive items, and disabled states.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <TriggerButton />
      <DropdownMenuContent>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuItem>Archive</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const WithSeparator: Story = {
  render: () => (
    <DropdownMenu>
      <TriggerButton />
      <DropdownMenuContent>
        <DropdownMenuItem>Cut</DropdownMenuItem>
        <DropdownMenuItem>Copy</DropdownMenuItem>
        <DropdownMenuItem>Paste</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Select All</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Find and Replace</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const WithGroupLabel: Story = {
  render: () => (
    <DropdownMenu>
      <TriggerButton />
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Actions</DropdownMenuGroupLabel>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Export</DropdownMenuGroupLabel>
          <DropdownMenuItem>Export as PDF</DropdownMenuItem>
          <DropdownMenuItem>Export as CSV</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const WithDestructiveItem: Story = {
  render: () => (
    <DropdownMenu>
      <TriggerButton />
      <DropdownMenuContent>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const WithSubmenu: Story = {
  render: () => (
    <DropdownMenu>
      <TriggerButton />
      <DropdownMenuContent>
        <DropdownMenuItem>New File</DropdownMenuItem>
        <DropdownMenuItem>Open</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Email</DropdownMenuItem>
            <DropdownMenuItem>Slack</DropdownMenuItem>
            <DropdownMenuItem>Copy Link</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Download</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

const WithRadioItemsDemo = () => {
  const [value, setValue] = useState('comfortable')

  return (
    <DropdownMenu>
      <TriggerButton label={`Density: ${value}`} />
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
          <DropdownMenuRadioItem value="compact">
            Compact
            <DropdownMenuRadioItemIndicator />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">
            Comfortable
            <DropdownMenuRadioItemIndicator />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="spacious">
            Spacious
            <DropdownMenuRadioItemIndicator />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <DropdownMenu>
      <TriggerButton label="View Options" />
      <DropdownMenuContent>
        <DropdownMenuCheckboxItem checked={showToolbar} onCheckedChange={setShowToolbar}>
          Toolbar
          <DropdownMenuCheckboxItemIndicator />
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={showSidebar} onCheckedChange={setShowSidebar}>
          Sidebar
          <DropdownMenuCheckboxItemIndicator />
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={showStatusBar} onCheckedChange={setShowStatusBar}>
          Status Bar
          <DropdownMenuCheckboxItemIndicator />
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const WithCheckboxItems: Story = {
  render: () => <WithCheckboxItemsDemo />,
}

export const WithDisabledItems: Story = {
  render: () => (
    <DropdownMenu>
      <TriggerButton />
      <DropdownMenuContent>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
        <DropdownMenuItem>Archive</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Restore</DropdownMenuItem>
        <DropdownMenuItem destructive>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const WithIcons: Story = {
  render: () => (
    <DropdownMenu>
      <TriggerButton />
      <DropdownMenuContent>
        <DropdownMenuItem>
          <RiPencilLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem>
          <RiFileCopyLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem>
          <RiArchiveLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
          Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>
          <RiDeleteBinLine aria-hidden className="size-4 shrink-0" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const WithLinkItems: Story = {
  render: () => (
    <DropdownMenu>
      <TriggerButton label="Open links" />
      <DropdownMenuContent>
        <DropdownMenuLinkItem href="https://docs.dify.ai" rel="noopener noreferrer" target="_blank">
          Dify Docs
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem href="https://roadmap.dify.ai" rel="noopener noreferrer" target="_blank">
          Product Roadmap
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

const ComplexDemo = () => {
  const [sortOrder, setSortOrder] = useState('newest')
  const [showArchived, setShowArchived] = useState(false)

  return (
    <DropdownMenu>
      <TriggerButton label="Actions" />
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Edit</DropdownMenuGroupLabel>
          <DropdownMenuItem>
            <RiPencilLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem>
            <RiFileCopyLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <RiLockLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
            Move to Workspace
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <RiShareLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
            Share
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>
              <RiMailLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
              Email
            </DropdownMenuItem>
            <DropdownMenuItem>
              <RiChat1Line aria-hidden className="size-4 shrink-0 text-text-tertiary" />
              Slack
            </DropdownMenuItem>
            <DropdownMenuItem>
              <RiLink aria-hidden className="size-4 shrink-0 text-text-tertiary" />
              Copy Link
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Sort by</DropdownMenuGroupLabel>
          <DropdownMenuRadioGroup value={sortOrder} onValueChange={setSortOrder}>
            <DropdownMenuRadioItem value="newest">
              Newest first
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="oldest">
              Oldest first
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="name">
              Name
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={showArchived} onCheckedChange={setShowArchived}>
          <RiArchiveLine aria-hidden className="size-4 shrink-0 text-text-tertiary" />
          Show Archived
          <DropdownMenuCheckboxItemIndicator />
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>
          <RiDeleteBinLine aria-hidden className="size-4 shrink-0" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const Complex: Story = {
  render: () => <ComplexDemo />,
}
