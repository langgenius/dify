import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import {
  createMenuHandle,
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuClear,
  MenuContent,
  MenuEmpty,
  MenuFilterProvider,
  MenuGroup,
  MenuGroupLabel,
  MenuInput,
  MenuInputGroup,
  MenuItem,
  MenuLinkItem,
  MenuList,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '.'
import { DirectionProvider } from '../direction-provider'

function TriggerButton({ label = 'Open Menu' }: { label?: string }) {
  return (
    <MenuTrigger
      render={
        <button
          type="button"
          className="rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover"
        />
      }
    >
      {label}
    </MenuTrigger>
  )
}

const meta = {
  title: 'Base/UI/Menu',
  component: Menu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound dropdown menu built on Base UI Menu. Supports items, separators, group labels, submenus, radio groups, checkbox items, destructive items, disabled states, and filtering. Filtering is a Base UI preview feature: wrap `Menu` in `MenuFilterProvider`, place `MenuInput` in a `MenuInputGroup` inside the content, and put the items in `MenuList`. The popup then becomes a dialog that holds the searchbox and the menu.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Menu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Menu>
      <TriggerButton />
      <MenuContent>
        <MenuItem>Edit</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuItem>Archive</MenuItem>
      </MenuContent>
    </Menu>
  ),
}

export const WithSeparator: Story = {
  render: () => (
    <Menu>
      <TriggerButton />
      <MenuContent>
        <MenuItem>Cut</MenuItem>
        <MenuItem>Copy</MenuItem>
        <MenuItem>Paste</MenuItem>
        <MenuSeparator />
        <MenuItem>Select All</MenuItem>
        <MenuSeparator />
        <MenuItem>Find and Replace</MenuItem>
      </MenuContent>
    </Menu>
  ),
}

export const WithGroupLabel: Story = {
  render: () => (
    <Menu>
      <TriggerButton />
      <MenuContent>
        <MenuGroup>
          <MenuGroupLabel>Actions</MenuGroupLabel>
          <MenuItem>Edit</MenuItem>
          <MenuItem>Duplicate</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Export</MenuGroupLabel>
          <MenuItem>Export as PDF</MenuItem>
          <MenuItem>Export as CSV</MenuItem>
        </MenuGroup>
      </MenuContent>
    </Menu>
  ),
}

export const WithDestructiveItem: Story = {
  render: () => (
    <Menu>
      <TriggerButton />
      <MenuContent>
        <MenuItem>Edit</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive">Delete</MenuItem>
      </MenuContent>
    </Menu>
  ),
}

export const WithSubmenu: Story = {
  render: () => (
    <Menu>
      <TriggerButton />
      <MenuContent>
        <MenuItem>New File</MenuItem>
        <MenuItem>Open</MenuItem>
        <MenuSeparator />
        <MenuSubmenu>
          <MenuSubmenuTrigger>Share</MenuSubmenuTrigger>
          <MenuContent>
            <MenuItem>Email</MenuItem>
            <MenuItem>Slack</MenuItem>
            <MenuItem>Copy Link</MenuItem>
          </MenuContent>
        </MenuSubmenu>
        <MenuSeparator />
        <MenuItem>Download</MenuItem>
      </MenuContent>
    </Menu>
  ),
}

export const RTL: Story = {
  parameters: {
    docs: {
      story: { autoplay: false },
      description: {
        story:
          'DirectionProvider controls keyboard navigation and placement. Set dir on the trigger wrapper and each portaled content when using a local RTL region. Submenus open with ArrowLeft and close with ArrowRight.',
      },
    },
  },
  render: () => (
    <DirectionProvider direction="rtl">
      <div
        lang="ar"
        dir="rtl"
        className="flex min-h-64 w-[min(36rem,calc(100vw-2rem))] items-start"
      >
        <Menu>
          <TriggerButton label="الإجراءات" />
          <MenuContent lang="ar" dir="rtl">
            <MenuSubmenu>
              <MenuSubmenuTrigger>
                <span>مشاركة</span>
              </MenuSubmenuTrigger>
              <MenuContent lang="ar" dir="rtl">
                <MenuItem>البريد الإلكتروني</MenuItem>
                <MenuItem>نسخ الرابط</MenuItem>
              </MenuContent>
            </MenuSubmenu>
            <MenuItem>تنزيل</MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </DirectionProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'الإجراءات' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    const share = await body.findByRole('menuitem', { name: 'مشاركة' })
    await waitFor(() => expect(share).toHaveFocus())

    const arrow = share.querySelector('[aria-hidden]')!
    await expect(getComputedStyle(arrow).scale).toBe('-1 1')
    await expect(arrow.getBoundingClientRect().right).toBeLessThanOrEqual(
      within(share).getByText('مشاركة').getBoundingClientRect().left,
    )

    await userEvent.keyboard('{ArrowLeft}')
    const submenu = await body.findByRole('menu', { name: 'مشاركة' })
    await waitFor(() =>
      expect(body.getByRole('menuitem', { name: 'البريد الإلكتروني' })).toHaveFocus(),
    )
    await waitFor(() => {
      expect(submenu.getBoundingClientRect().right).toBeLessThanOrEqual(
        share.getBoundingClientRect().left,
      )
    })

    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(share).toHaveFocus())
    await waitFor(() =>
      expect(body.queryByRole('menu', { name: 'مشاركة' })).not.toBeInTheDocument(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
}

type Density = 'compact' | 'comfortable' | 'spacious'

function WithRadioItemsDemo() {
  const [density, setDensity] = React.useState<Density>('comfortable')

  return (
    <Menu>
      <TriggerButton label={`Density: ${density}`} />
      <MenuContent>
        <MenuRadioGroup<Density> value={density} onValueChange={setDensity}>
          <MenuRadioItem<Density> value="compact">
            Compact
            <MenuRadioItemIndicator />
          </MenuRadioItem>
          <MenuRadioItem<Density> value="comfortable">
            Comfortable
            <MenuRadioItemIndicator />
          </MenuRadioItem>
          <MenuRadioItem<Density> value="spacious">
            Spacious
            <MenuRadioItemIndicator />
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
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
    <Menu>
      <TriggerButton label="View Options" />
      <MenuContent>
        <MenuCheckboxItem checked={showToolbar} onCheckedChange={setShowToolbar}>
          Toolbar
          <MenuCheckboxItemIndicator />
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={showSidebar} onCheckedChange={setShowSidebar}>
          Sidebar
          <MenuCheckboxItemIndicator />
        </MenuCheckboxItem>
        <MenuCheckboxItem checked={showStatusBar} onCheckedChange={setShowStatusBar}>
          Status Bar
          <MenuCheckboxItemIndicator />
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  )
}

export const WithCheckboxItems: Story = {
  render: () => <WithCheckboxItemsDemo />,
}

export const WithDisabledItems: Story = {
  render: () => (
    <Menu>
      <TriggerButton />
      <MenuContent>
        <MenuItem>Edit</MenuItem>
        <MenuItem disabled>Duplicate</MenuItem>
        <MenuItem>Archive</MenuItem>
        <MenuSeparator />
        <MenuItem disabled>Restore</MenuItem>
        <MenuItem variant="destructive">Delete</MenuItem>
      </MenuContent>
    </Menu>
  ),
}

export const WithIcons: Story = {
  render: () => (
    <Menu>
      <TriggerButton />
      <MenuContent>
        <MenuItem>
          <span aria-hidden className="i-ri-pencil-line size-4 shrink-0 text-text-tertiary" />
          Edit
        </MenuItem>
        <MenuItem>
          <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
          Duplicate
        </MenuItem>
        <MenuItem>
          <span aria-hidden className="i-ri-archive-line size-4 shrink-0 text-text-tertiary" />
          Archive
        </MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive">
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  ),
}

export const WithLinkItems: Story = {
  render: () => (
    <Menu>
      <TriggerButton label="Open links" />
      <MenuContent>
        <MenuLinkItem href="https://docs.dify.ai" rel="noopener noreferrer" target="_blank">
          Dify Docs
        </MenuLinkItem>
        <MenuLinkItem href="https://roadmap.dify.ai" rel="noopener noreferrer" target="_blank">
          Product Roadmap
        </MenuLinkItem>
      </MenuContent>
    </Menu>
  ),
}

type SortOrder = 'newest' | 'oldest' | 'name'

function ComplexDemo() {
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('newest')
  const [showArchived, setShowArchived] = React.useState(false)

  return (
    <Menu>
      <TriggerButton label="Actions" />
      <MenuContent>
        <MenuGroup>
          <MenuGroupLabel>Edit</MenuGroupLabel>
          <MenuItem>
            <span aria-hidden className="i-ri-pencil-line size-4 shrink-0 text-text-tertiary" />
            Rename
          </MenuItem>
          <MenuItem>
            <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
            Duplicate
          </MenuItem>
          <MenuItem disabled>
            <span aria-hidden className="i-ri-lock-line size-4 shrink-0 text-text-tertiary" />
            Move to Workspace
          </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuSubmenu>
          <MenuSubmenuTrigger>
            <span aria-hidden className="i-ri-share-line size-4 shrink-0 text-text-tertiary" />
            Share
          </MenuSubmenuTrigger>
          <MenuContent>
            <MenuItem>
              <span aria-hidden className="i-ri-mail-line size-4 shrink-0 text-text-tertiary" />
              Email
            </MenuItem>
            <MenuItem>
              <span aria-hidden className="i-ri-chat-1-line size-4 shrink-0 text-text-tertiary" />
              Slack
            </MenuItem>
            <MenuItem>
              <span aria-hidden className="i-ri-link size-4 shrink-0 text-text-tertiary" />
              Copy Link
            </MenuItem>
          </MenuContent>
        </MenuSubmenu>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Sort by</MenuGroupLabel>
          <MenuRadioGroup<SortOrder> value={sortOrder} onValueChange={setSortOrder}>
            <MenuRadioItem<SortOrder> value="newest">
              Newest first
              <MenuRadioItemIndicator />
            </MenuRadioItem>
            <MenuRadioItem<SortOrder> value="oldest">
              Oldest first
              <MenuRadioItemIndicator />
            </MenuRadioItem>
            <MenuRadioItem<SortOrder> value="name">
              Name
              <MenuRadioItemIndicator />
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuCheckboxItem checked={showArchived} onCheckedChange={setShowArchived}>
          <span aria-hidden className="i-ri-archive-line size-4 shrink-0 text-text-tertiary" />
          Show Archived
          <MenuCheckboxItemIndicator />
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuItem variant="destructive">
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

export const Complex: Story = {
  render: () => <ComplexDemo />,
}

function DetachedTriggerDemo() {
  const [handle] = React.useState(() => createMenuHandle<{ name: string }>())
  const [selected, setSelected] = React.useState('')
  return (
    <React.Fragment>
      <MenuTrigger
        handle={handle}
        payload={{ name: 'Report' }}
        className="rounded-lg border border-divider-subtle px-3 py-1.5"
      >
        Report actions
      </MenuTrigger>
      <Menu handle={handle}>
        {({ payload }) => (
          <MenuContent>
            <MenuGroup>
              <MenuGroupLabel>{payload?.name}</MenuGroupLabel>
              <MenuItem onClick={() => setSelected(payload?.name ?? '')}>Archive</MenuItem>
            </MenuGroup>
          </MenuContent>
        )}
      </Menu>
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

const moveTargets = ['Personal space', 'Team space', 'Archive']
const shareTargets = ['Design team', 'Engineering team', 'Everyone']

function FilterableDemo() {
  const [lastAction, setLastAction] = React.useState<string | null>(null)

  return (
    <div className="flex flex-col items-start gap-3">
      <MenuFilterProvider>
        <Menu>
          <TriggerButton label="Workspace actions" />
          <MenuContent className="w-64">
            <MenuInputGroup>
              <span
                aria-hidden
                className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
              />
              <MenuInput aria-label="Filter actions" placeholder="Filter actions…" />
              <MenuClear />
            </MenuInputGroup>
            <MenuEmpty>No actions match</MenuEmpty>
            <MenuList>
              {filterableActionGroups.map((group, index) => (
                <MenuGroup key={group.label}>
                  {index > 0 && <MenuSeparator />}
                  <MenuGroupLabel>{group.label}</MenuGroupLabel>
                  {group.actions.map((action) => (
                    <MenuItem
                      key={action}
                      variant={group.label === 'Danger zone' ? 'destructive' : 'default'}
                      onClick={() => setLastAction(action)}
                    >
                      {action}
                    </MenuItem>
                  ))}
                  {index === 0 && (
                    <React.Fragment>
                      {/* A submenu without its own provider stays unfiltered. */}
                      <MenuSubmenu>
                        <MenuSubmenuTrigger>Move to</MenuSubmenuTrigger>
                        <MenuContent>
                          <MenuList>
                            {moveTargets.map((target) => (
                              <MenuItem
                                key={target}
                                onClick={() => setLastAction(`Move to ${target}`)}
                              >
                                {target}
                              </MenuItem>
                            ))}
                          </MenuList>
                        </MenuContent>
                      </MenuSubmenu>
                      {/* A submenu wrapped in its own provider filters with its own input. */}
                      <MenuFilterProvider>
                        <MenuSubmenu>
                          <MenuSubmenuTrigger>Share with</MenuSubmenuTrigger>
                          <MenuContent>
                            <MenuInputGroup>
                              <span
                                aria-hidden
                                className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
                              />
                              <MenuInput aria-label="Filter teams" placeholder="Filter teams…" />
                              <MenuClear />
                            </MenuInputGroup>
                            <MenuEmpty>No teams match</MenuEmpty>
                            <MenuList>
                              {shareTargets.map((target) => (
                                <MenuItem
                                  key={target}
                                  onClick={() => setLastAction(`Share with ${target}`)}
                                >
                                  {target}
                                </MenuItem>
                              ))}
                            </MenuList>
                          </MenuContent>
                        </MenuSubmenu>
                      </MenuFilterProvider>
                    </React.Fragment>
                  )}
                </MenuGroup>
              ))}
            </MenuList>
          </MenuContent>
        </Menu>
      </MenuFilterProvider>
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
          'Filtering is a Base UI preview feature. Opening with a click or the keyboard focuses the input; opening on hover does not, so the on-screen keyboard stays hidden. Arrow keys move the highlight while the input keeps focus, Enter runs the highlighted action, Tab closes the menu, and Shift+Tab returns focus to the trigger. Groups without matches hide, and the empty state announces when nothing matches. Place the separator between groups inside the later group so it hides with the groups before it. A submenu trigger matches like an item; a submenu stays unfiltered unless its `MenuSubmenu` is wrapped in its own `MenuFilterProvider` with its own input, as "Share with" is. In LTR, the right arrow opens a submenu and focuses its input when it has one, the left arrow closes it from an empty input and returns focus to the parent input, and each level keeps its own query. RTL reverses these horizontal keys. Pass `autoHighlight` to highlight the first match while typing.',
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
    const isRtl = getComputedStyle(input).direction === 'rtl'
    const openSubmenuKey = isRtl ? '{ArrowLeft}' : '{ArrowRight}'
    const closeSubmenuKey = isRtl ? '{ArrowRight}' : '{ArrowLeft}'
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
    await expect(input).not.toHaveAttribute('data-highlighted')

    await userEvent.clear(input)
    await userEvent.type(input, 'archive')
    await expect(body.getByRole('menuitem', { name: 'Archive workspace' })).toBeInTheDocument()
    await expect(body.queryByText('Workspace')).not.toBeVisible()
    for (const separator of body.queryAllByRole('separator', { hidden: true })) {
      await expect(separator).not.toBeVisible()
    }

    // An unfiltered submenu opens from the parent query and closes back into it.
    await userEvent.clear(input)
    await userEvent.type(input, 'move')
    await expect(body.getByRole('menuitem', { name: 'Move to' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(async () => {
      await expect(body.getByRole('menuitem', { name: 'Move to' })).toHaveAttribute(
        'data-highlighted',
      )
    })
    await userEvent.keyboard(openSubmenuKey)
    const personalSpace = await body.findByRole('menuitem', { name: 'Personal space' })
    await waitFor(async () => {
      await expect(personalSpace).toHaveFocus()
    })
    await userEvent.keyboard(closeSubmenuKey)
    await waitFor(async () => {
      await expect(body.queryByRole('menuitem', { name: 'Team space' })).not.toBeInTheDocument()
    })

    // A filterable submenu focuses its own input and keeps its own query.
    await userEvent.clear(input)
    await userEvent.type(input, 'share')
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(async () => {
      await expect(body.getByRole('menuitem', { name: 'Share with' })).toHaveAttribute(
        'data-highlighted',
      )
    })
    await userEvent.keyboard(openSubmenuKey)
    const submenuInput = await body.findByRole('searchbox', { name: 'Filter teams' })
    await waitFor(async () => {
      await expect(submenuInput).toHaveFocus()
    })
    // The closing arrow key dismisses the submenu only from an empty input; with text it moves the caret.
    await userEvent.keyboard(closeSubmenuKey)
    await waitFor(async () => {
      await expect(body.queryByRole('searchbox', { name: 'Filter teams' })).not.toBeInTheDocument()
    })
    await waitFor(async () => {
      await expect(input).toHaveFocus()
    })
    await expect(input).toHaveValue('share')
    await userEvent.keyboard(openSubmenuKey)
    const reopenedSubmenuInput = await body.findByRole('searchbox', { name: 'Filter teams' })
    await waitFor(async () => {
      await expect(reopenedSubmenuInput).toHaveFocus()
    })
    await userEvent.type(reopenedSubmenuInput, 'eng')
    await expect(body.getByRole('menuitem', { name: 'Engineering team' })).toBeInTheDocument()
    await expect(body.queryByRole('menuitem', { name: 'Everyone' })).not.toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(async () => {
      await expect(body.getByRole('menuitem', { name: 'Engineering team' })).toHaveAttribute(
        'data-highlighted',
      )
    })
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status', { name: 'Last action' })).toHaveTextContent(
      'Share with Engineering team',
    )
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(async () => {
      await expect(input).not.toBeInTheDocument()
    })

    await userEvent.click(trigger)
    const reopenedInput = await body.findByRole('searchbox', { name: 'Filter actions' })
    await waitFor(async () => {
      await expect(reopenedInput).toHaveFocus()
    })
    await userEvent.type(reopenedInput, 'zzz')
    await expect(await body.findByText('No actions match')).toHaveAttribute('role', 'status')

    await userEvent.clear(reopenedInput)
    await userEvent.type(reopenedInput, 'rename')
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(async () => {
      await expect(body.getByRole('menuitem', { name: 'Rename workspace' })).toHaveAttribute(
        'data-highlighted',
      )
    })
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status', { name: 'Last action' })).toHaveTextContent(
      'Rename workspace',
    )
    await waitFor(async () => {
      await expect(reopenedInput).not.toBeInTheDocument()
    })

    await userEvent.click(trigger)
    const finalInput = await body.findByRole('searchbox', { name: 'Filter actions' })
    const popup = body.getByRole('menu')
    await waitFor(async () => {
      await expect(finalInput).toHaveFocus()
    })
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(async () => {
      await expect(trigger).toHaveFocus()
    })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(async () => {
      await expect(popup).not.toBeInTheDocument()
    })
  },
}
