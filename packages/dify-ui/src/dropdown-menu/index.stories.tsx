import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
  createDropdownMenuHandle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemIndicator,
  DropdownMenuClear,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFilterProvider,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuInput,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuList,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '.'
import { InputGroup, InputGroupAddon } from '../input-group'

function TriggerButton({ label = 'Open Menu' }: { label?: string }) {
  return (
    <DropdownMenuTrigger
      render={
        <button
          type="button"
          className="rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover"
        />
      }
    >
      {label}
    </DropdownMenuTrigger>
  )
}

const meta = {
  title: 'Base/UI/DropdownMenu',
  component: DropdownMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound dropdown menu built on Base UI Menu. Supports items, separators, group labels, submenus, radio groups, checkbox items, destructive items, disabled states, and filtering. Filtering is a Base UI preview feature: wrap `DropdownMenu` in `DropdownMenuFilterProvider`, place `DropdownMenuInput` inside the content (as the direct input of an `InputGroup` when it needs an icon or `DropdownMenuClear`), and put the items in `DropdownMenuList`. The popup then becomes a dialog that holds the searchbox and the menu.',
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
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
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

type Density = 'compact' | 'comfortable' | 'spacious'

function WithRadioItemsDemo() {
  const [density, setDensity] = React.useState<Density>('comfortable')

  return (
    <DropdownMenu>
      <TriggerButton label={`Density: ${density}`} />
      <DropdownMenuContent>
        <DropdownMenuRadioGroup<Density> value={density} onValueChange={setDensity}>
          <DropdownMenuRadioItem<Density> value="compact">
            Compact
            <DropdownMenuRadioItemIndicator />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem<Density> value="comfortable">
            Comfortable
            <DropdownMenuRadioItemIndicator />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem<Density> value="spacious">
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

function WithCheckboxItemsDemo() {
  const [showToolbar, setShowToolbar] = React.useState(true)
  const [showSidebar, setShowSidebar] = React.useState(false)
  const [showStatusBar, setShowStatusBar] = React.useState(true)

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
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
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
          <span aria-hidden className="i-ri-pencil-line size-4 shrink-0 text-text-tertiary" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem>
          <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem>
          <span aria-hidden className="i-ri-archive-line size-4 shrink-0 text-text-tertiary" />
          Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
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
        <DropdownMenuLinkItem
          href="https://roadmap.dify.ai"
          rel="noopener noreferrer"
          target="_blank"
        >
          Product Roadmap
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

type SortOrder = 'newest' | 'oldest' | 'name'

function ComplexDemo() {
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('newest')
  const [showArchived, setShowArchived] = React.useState(false)

  return (
    <DropdownMenu>
      <TriggerButton label="Actions" />
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Edit</DropdownMenuGroupLabel>
          <DropdownMenuItem>
            <span aria-hidden className="i-ri-pencil-line size-4 shrink-0 text-text-tertiary" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem>
            <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <span aria-hidden className="i-ri-lock-line size-4 shrink-0 text-text-tertiary" />
            Move to Workspace
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span aria-hidden className="i-ri-share-line size-4 shrink-0 text-text-tertiary" />
            Share
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>
              <span aria-hidden className="i-ri-mail-line size-4 shrink-0 text-text-tertiary" />
              Email
            </DropdownMenuItem>
            <DropdownMenuItem>
              <span aria-hidden className="i-ri-chat-1-line size-4 shrink-0 text-text-tertiary" />
              Slack
            </DropdownMenuItem>
            <DropdownMenuItem>
              <span aria-hidden className="i-ri-link size-4 shrink-0 text-text-tertiary" />
              Copy Link
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Sort by</DropdownMenuGroupLabel>
          <DropdownMenuRadioGroup<SortOrder> value={sortOrder} onValueChange={setSortOrder}>
            <DropdownMenuRadioItem<SortOrder> value="newest">
              Newest first
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem<SortOrder> value="oldest">
              Oldest first
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem<SortOrder> value="name">
              Name
              <DropdownMenuRadioItemIndicator />
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={showArchived} onCheckedChange={setShowArchived}>
          <span aria-hidden className="i-ri-archive-line size-4 shrink-0 text-text-tertiary" />
          Show Archived
          <DropdownMenuCheckboxItemIndicator />
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const Complex: Story = {
  render: () => <ComplexDemo />,
}

function DetachedTriggerDemo() {
  const handle = React.useMemo(() => createDropdownMenuHandle<{ name: string }>(), [])
  const [selected, setSelected] = React.useState('')
  return (
    <React.Fragment>
      <DropdownMenuTrigger
        handle={handle}
        payload={{ name: 'Report' }}
        className="rounded-lg border border-divider-subtle px-3 py-1.5"
      >
        Report actions
      </DropdownMenuTrigger>
      <DropdownMenu handle={handle}>
        {({ payload }) => (
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel>{payload?.name}</DropdownMenuGroupLabel>
              <DropdownMenuItem onClick={() => setSelected(payload?.name ?? '')}>
                Archive
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
      <output aria-label="Archived document">{selected}</output>
    </React.Fragment>
  )
}

export const DetachedTrigger: Story = {
  render: () => <DetachedTriggerDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'Report actions' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    const archive = await body.findByRole('menuitem', { name: 'Archive' })
    await waitFor(async () => {
      await expect(archive).toHaveFocus()
    })
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status', { name: 'Archived document' })).toHaveTextContent(
      'Report',
    )
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(async () => {
      await expect(trigger).toHaveFocus()
    })
  },
}

const filterableActionGroups = [
  {
    label: 'Workspace',
    actions: ['Rename workspace', 'Invite members', 'Manage billing'],
  },
  {
    label: 'Danger zone',
    actions: ['Archive workspace', 'Delete workspace'],
  },
]

function FilterableDemo() {
  const [lastAction, setLastAction] = React.useState<string | null>(null)

  return (
    <div className="flex flex-col items-start gap-3">
      <DropdownMenuFilterProvider>
        <DropdownMenu>
          <TriggerButton label="Workspace actions" />
          <DropdownMenuContent className="w-64">
            <InputGroup className="mx-1 mb-1 w-auto">
              <DropdownMenuInput aria-label="Filter actions" placeholder="Filter actions…" />
              <InputGroupAddon className="ps-2">
                <span
                  aria-hidden
                  className="i-ri-search-line size-4 text-components-input-text-placeholder"
                />
              </InputGroupAddon>
              <InputGroupAddon align="inline-end" className="pe-1.5">
                <DropdownMenuClear />
              </InputGroupAddon>
            </InputGroup>
            <DropdownMenuEmpty>No actions match</DropdownMenuEmpty>
            <DropdownMenuList>
              {filterableActionGroups.map((group, index) => (
                <DropdownMenuGroup key={group.label}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuGroupLabel>{group.label}</DropdownMenuGroupLabel>
                  {group.actions.map((action) => (
                    <DropdownMenuItem
                      key={action}
                      variant={group.label === 'Danger zone' ? 'destructive' : 'default'}
                      onClick={() => setLastAction(action)}
                    >
                      {action}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuList>
          </DropdownMenuContent>
        </DropdownMenu>
      </DropdownMenuFilterProvider>
      <p role="status" aria-label="Last action" className="system-xs-regular text-text-tertiary">
        {lastAction ?? 'No action yet'}
      </p>
    </div>
  )
}

export const Filterable: Story = {
  parameters: {
    docs: {
      story: { autoplay: false },
      description: {
        story:
          'Filtering is a Base UI preview feature. Opening with a click or the keyboard focuses the input; opening on hover does not, so the on-screen keyboard stays hidden. Arrow keys move the highlight while the input keeps focus, Enter runs the highlighted action, Tab closes the menu, and Shift+Tab returns focus to the trigger. Groups without matches hide, and the empty state announces when nothing matches.',
      },
    },
  },
  render: () => <FilterableDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'Workspace actions' })

    await userEvent.click(trigger)
    const input = await body.findByRole('searchbox', { name: 'Filter actions' })
    await waitFor(async () => {
      await expect(input).toHaveFocus()
    })
    await expect(body.getByRole('menuitem', { name: 'Manage billing' })).toBeInTheDocument()

    await userEvent.type(input, 'billing')
    await expect(body.getByRole('menuitem', { name: 'Manage billing' })).toBeInTheDocument()
    await expect(body.queryByRole('menuitem', { name: 'Rename workspace' })).not.toBeInTheDocument()
    await expect(body.queryByText('Danger zone')).not.toBeVisible()

    await userEvent.keyboard('{ArrowDown}')
    await expect(body.getByRole('menuitem', { name: 'Manage billing' })).toHaveAttribute(
      'data-highlighted',
    )
    await expect(input).toHaveFocus()

    await userEvent.type(input, 'zzz')
    await expect(await body.findByText('No actions match')).toHaveAttribute('role', 'status')

    await userEvent.clear(input)
    await userEvent.type(input, 'rename')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(canvas.getByRole('status', { name: 'Last action' })).toHaveTextContent(
      'Rename workspace',
    )
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(trigger)
    await body.findByRole('searchbox', { name: 'Filter actions' })
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(async () => {
      await expect(trigger).toHaveFocus()
    })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
}
