import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FormatDisplayOptions, RegisterableHotkey } from '@tanstack/react-hotkeys'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { Kbd, KbdGroup } from '.'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../context-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../tooltip'

const meta = {
  title: 'Base/UI/Kbd',
  component: Kbd,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Keyboard input primitives aligned with the Dify Key Set design. '
          + '`Kbd` renders a native `<kbd>` element for a single key or key-like token. '
          + '`KbdGroup` only groups multiple keycaps; it does not replace the individual `<kbd>` semantics.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    color: {
      control: 'select',
      options: ['gray', 'white'],
    },
    disabled: { control: 'boolean' },
  },
  args: {
    children: 'K',
    color: 'gray',
  },
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

const displayKeys = (
  hotkey: RegisterableHotkey | (string & {}),
  platform: FormatDisplayOptions['platform'] = 'mac',
) => {
  if (typeof hotkey !== 'string')
    return [formatForDisplay(hotkey, { platform })]

  return hotkey
    .split('+')
    .filter(Boolean)
    .map(key => formatForDisplay(key, { platform }))
}

const HotkeyKbdGroup = ({
  hotkey,
  color = 'gray',
  platform = 'mac',
}: {
  hotkey: RegisterableHotkey | (string & {})
  color?: 'gray' | 'white'
  platform?: FormatDisplayOptions['platform']
}) => (
  <KbdGroup>
    {displayKeys(hotkey, platform).map((key, index) => (
      // eslint-disable-next-line react/no-array-index-key -- Repeated display keys are static, ordered tokens with no component state.
      <Kbd key={`${key}-${index}`} color={color}>
        {key}
      </Kbd>
    ))}
  </KbdGroup>
)

export const Default: Story = {
  render: () => <HotkeyKbdGroup hotkey="Mod+K" />,
}

export const KeySet: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Figma Key Set variants: gray and white, each with a disabled state. Disabled is visual only because `<kbd>` is not an interactive widget.',
      },
    },
  },
  render: () => (
    <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-4 gap-y-3 rounded-xl bg-components-panel-bg p-5">
      <span className="system-xs-medium text-text-tertiary">Gray</span>
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>⇧</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd disabled>⌘</Kbd>
        <Kbd disabled>⇧</Kbd>
      </KbdGroup>

      <span className="system-xs-medium text-text-tertiary">White</span>
      <div className="rounded-lg bg-gray-900 p-2">
        <KbdGroup>
          <Kbd color="white">⌘</Kbd>
          <Kbd color="white">⇧</Kbd>
        </KbdGroup>
      </div>
      <div className="rounded-lg bg-gray-900 p-2">
        <KbdGroup>
          <Kbd color="white" disabled>⌘</Kbd>
          <Kbd color="white" disabled>⇧</Kbd>
        </KbdGroup>
      </div>
    </div>
  ),
}

export const FormattedShortcuts: Story = {
  parameters: {
    docs: {
      description: {
        story: '`Kbd` does not parse hotkeys. Compose it with a formatter at the feature layer; this story uses TanStack Hotkeys `formatForDisplay` for platform-aware labels.',
      },
    },
  },
  render: () => (
    <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-5 gap-y-3 rounded-xl bg-components-panel-bg p-5">
      <span className="system-xs-medium text-text-tertiary">Action</span>
      <span className="system-xs-medium text-text-tertiary">macOS</span>
      <span className="system-xs-medium text-text-tertiary">Windows</span>

      <span className="system-sm-regular text-text-secondary">Search</span>
      <HotkeyKbdGroup hotkey="Mod+K" platform="mac" />
      <HotkeyKbdGroup hotkey="Mod+K" platform="windows" />

      <span className="system-sm-regular text-text-secondary">Save</span>
      <HotkeyKbdGroup hotkey="Mod+S" platform="mac" />
      <HotkeyKbdGroup hotkey="Mod+S" platform="windows" />

      <span className="system-sm-regular text-text-secondary">Redo</span>
      <HotkeyKbdGroup hotkey="Mod+Shift+Z" platform="mac" />
      <HotkeyKbdGroup hotkey="Mod+Shift+Z" platform="windows" />
    </div>
  ),
}

export const InTooltip: Story = {
  decorators: [
    Story => (
      <TooltipProvider delay={0}>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Shortcut keycaps can be composed inside short tooltip content. The trigger keeps its own accessible name; the tooltip is only a visual hint.',
      },
    },
  },
  render: () => (
    <Tooltip open>
      <TooltipTrigger
        render={(
          <button
            type="button"
            aria-label="Collapse sidebar"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-divider-subtle bg-components-button-secondary-bg text-text-secondary shadow-xs outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span aria-hidden className="i-ri-sidebar-fold-line size-4" />
          </button>
        )}
      />
      <TooltipContent className="flex items-center gap-1">
        <span>Collapse sidebar</span>
        <HotkeyKbdGroup hotkey="Mod+B" />
      </TooltipContent>
    </Tooltip>
  ),
}

const MENU_ITEMS = [
  { label: 'Copy', icon: 'i-ri-file-copy-line', hotkey: 'Mod+C' },
  { label: 'Duplicate', icon: 'i-ri-stack-line', hotkey: 'Mod+D' },
  { label: 'Paste', icon: 'i-ri-clipboard-line', hotkey: 'Mod+V' },
] as const

export const InContextMenu: Story = {
  parameters: {
    docs: {
      description: {
        story: 'A compact context-menu composition based on the Dify Design Kit context menu example. The menu is intentionally small here because the story focuses on shortcut keycaps.',
      },
    },
  },
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger
        render={(
          <button
            type="button"
            className="flex h-28 w-60 items-center justify-center rounded-xl border border-divider-subtle bg-background-default-subtle px-6 text-center system-sm-regular text-text-tertiary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          />
        )}
      >
        Context menu trigger
      </ContextMenuTrigger>
      <ContextMenuContent popupClassName="w-60">
        {MENU_ITEMS.map(({ label, icon, hotkey }) => (
          <ContextMenuItem key={label} className="justify-between gap-4">
            <span aria-hidden className={`${icon} size-4 shrink-0 text-text-tertiary`} />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <HotkeyKbdGroup hotkey={hotkey} />
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" className="justify-between gap-4">
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Delete</span>
          <HotkeyKbdGroup hotkey="Delete" />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}
