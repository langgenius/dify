import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '.'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from '../dropdown-menu'
import { IconButton } from '../icon-button'

const avatarUrl = 'https://i.pravatar.cc/96?u=avatar-default'

const meta = {
  title: 'Base/UI/Avatar',
  component: Avatar,
  subcomponents: { AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount },
  parameters: {
    docs: {
      description: {
        component: `Compose an image and fallback inside Avatar. Import these components and their matching props types from \`@langgenius/dify-ui/avatar\`.

| Part | Responsibility |
| --- | --- |
| \`Avatar\` | Styles Base UI Root and owns the shared size. Defaults to \`md\` (32px). |
| \`AvatarImage\` | Uses Base UI image loading, error handling, and source changes. Accepts native image props, \`keepMounted\`, and \`onLoadingStatusChange\`. |
| \`AvatarFallback\` | Owns the default background and displays caller-provided content while the image is unavailable. Inherits size from Avatar and supports Base UI \`delay\`. |
| \`AvatarGroup\` | Dify visual extension for overlapping children by 4px. Avatars and counts use a 1px panel ring, including inside wrappers. Supplies their default size; explicit child sizes win. Callers control stacking with \`z-index\`. |
| \`AvatarGroupCount\` | Dify visual extension for caller-provided overflow text such as \`+2\`. Inherits Group size, or defaults to \`md\` (32px) outside a group, matching Avatar. |

Without an explicit size, children inherit the enclosing group's size or fall back to \`md\`. Override a grouped ring with \`group-[&]/avatar-group:ring-0\`; ring colors use ordinary \`ring-*\` classes.

The first three parts preserve Base UI \`render\`, refs, and state-aware \`className\` / \`style\` props. See the [Base UI Avatar documentation](https://base-ui.com/react/components/avatar) for their underlying API. Group and GroupCount accept native span props; they do not expose Base UI render or state callbacks.

Callers own names, initial extraction, colors, and image URLs. Apply custom fallback colors to AvatarFallback; Avatar has no default background, so transparent images retain their transparency. For an independent identity, give Avatar \`role="img"\` and the full name through \`aria-label\`, with an empty image \`alt\`. This keeps the accessible name stable when the image fails. When adjacent text or the surrounding control already identifies the person, hide the avatar with \`aria-hidden="true"\`.

Group only owns presentation. Callers choose which avatars to show, compute overflow, localize its label, and provide any interaction. It renders children unchanged, including arrays and fragments. Give earlier avatars a higher \`z-index\` when they should overlap later avatars.`,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'],
      description: 'Shared image and fallback size: 16, 20, 24, 32, 36, 40, 48, or 64px.',
      table: { defaultValue: { summary: 'md' } },
    },
  },
  args: { size: 'xl' },
  render: (args) => (
    <Avatar {...args} role="img" aria-label="Alex Doe">
      <AvatarFallback>A</AvatarFallback>
      <AvatarImage src={avatarUrl} alt="" />
    </Avatar>
  ),
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story: 'A standalone identity with a stable accessible name. The example uses xl (40px).',
      },
      source: {
        code: `import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'

<Avatar size="xl" role="img" aria-label="Alex Doe">
  <AvatarFallback>A</AvatarFallback>
  <AvatarImage src="https://i.pravatar.cc/96?u=avatar-default" alt="" />
</Avatar>`,
      },
    },
  },
}

export const WithFallback: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'An image is optional. Supply initials or an icon as fallback content; Avatar does not derive them from a name. The same fallback appears when an image fails.',
      },
    },
  },
  render: (args) => (
    <Avatar {...args} role="img" aria-label="Alex Doe">
      <AvatarFallback>A</AvatarFallback>
    </Avatar>
  ),
}

export const AllSizes: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Set size on Avatar. Image dimensions and fallback typography follow the root.',
      },
    },
  },
  render: () => (
    <div className="flex items-end gap-4">
      {(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Avatar size={size} role="img" aria-label="Alex Doe">
            <AvatarFallback>A</AvatarFallback>
            <AvatarImage src={avatarUrl} alt="" />
          </Avatar>
          <span className="text-xs text-text-tertiary">{size}</span>
        </div>
      ))}
    </div>
  ),
}

export const AllFallbackSizes: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Fallback typography across all eight sizes. AvatarFallback has no independent size prop.',
      },
    },
  },
  render: () => (
    <div className="flex items-end gap-4">
      {(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Avatar size={size} role="img" aria-label="Alex Doe">
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
          <span className="text-xs text-text-tertiary">{size}</span>
        </div>
      ))}
    </div>
  ),
}

export const Decorative: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The adjacent name already identifies the person. Hide the entire avatar to avoid announcing the name or initial twice.',
      },
    },
  },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Avatar {...args} aria-hidden="true">
        <AvatarFallback>A</AvatarFallback>
        <AvatarImage src={avatarUrl} alt="" />
      </Avatar>
      <span>Alex Doe</span>
    </div>
  ),
}

export const LazyImage: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Combine keepMounted with native loading="lazy" so the browser can load the rendered image. Place Fallback before Image. Dify hides loading and failed images with visibility: hidden, preserving their layout for lazy loading. Base UI owns loading status and fallback visibility.',
      },
    },
  },
  render: (args) => (
    <Avatar {...args} role="img" aria-label="Alex Doe">
      <AvatarFallback>A</AvatarFallback>
      <AvatarImage keepMounted loading="lazy" src={avatarUrl} alt="" />
    </Avatar>
  ),
}

export const Group: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Dify adds Group and GroupCount; they are not Base UI Avatar parts. This Design Kit example uses sm (24px): three avatars and one count overlap by 4px for a total width of 84px. Group supplies the shared sm size; the caller supplies the stacking order, +2, and its accessible label; the group does not slice a member list or calculate the count.',
      },
    },
  },
  render: () => (
    <AvatarGroup size="sm">
      <Avatar role="img" aria-label="Alex Doe" className="z-30">
        <AvatarFallback>A</AvatarFallback>
        <AvatarImage src={avatarUrl} alt="" />
      </Avatar>
      <Avatar role="img" aria-label="Emma" className="z-20">
        <AvatarFallback className="bg-components-icon-bg-blue-solid">E</AvatarFallback>
      </Avatar>
      <Avatar role="img" aria-label="Sam" className="z-10">
        <AvatarFallback className="bg-components-icon-bg-orange-dark-solid">S</AvatarFallback>
      </Avatar>
      <AvatarGroupCount role="img" aria-label="2 more people">
        +2
      </AvatarGroupCount>
    </AvatarGroup>
  ),
}

const collaborators = [
  { name: 'Emma', initial: 'E', color: 'bg-components-icon-bg-blue-solid', href: '#emma' },
  { name: 'Sam', initial: 'S', color: 'bg-components-icon-bg-orange-dark-solid', href: '#sam' },
  { name: 'Robin', initial: 'R', color: 'bg-components-icon-bg-teal-solid', href: '#robin' },
  { name: 'Alex', initial: 'A', color: 'bg-components-icon-bg-midnight-solid', href: '#alex' },
]

export const Collaborators: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A Design Kit collaborator control: 24px avatars inside a rounded panel button with a 12px chevron. Compose the trigger with IconButton through render to retain button styling and cursor behavior. This capsule supplies its own dimensions instead of an IconButton square size. DropdownMenu owns keyboard navigation, expanded state, and focus restoration; the avatars inside its named trigger are decorative. The example links represent collaborator profiles.',
      },
    },
  },
  render: () => (
    <div className="flex min-h-32 items-center justify-center rounded-xl bg-background-section p-8">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              aria-label="View 4 collaborators"
              variant="secondary"
              size={null}
              className="rounded-2xl bg-components-panel-bg-blur py-1 pr-1.5 pl-1 inset-ring-components-panel-border hover:bg-components-panel-bg hover:inset-ring-components-panel-border data-popup-open:bg-components-panel-bg"
            >
              <span aria-hidden="true" className="inline-flex items-center gap-px">
                <AvatarGroup size="sm">
                  {collaborators.slice(0, 2).map((person, index) => (
                    <Avatar key={person.name} style={{ zIndex: 2 - index }}>
                      <AvatarFallback className={`${person.color} text-[13px] font-semibold`}>
                        <span className="bg-linear-to-b from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text text-transparent opacity-90">
                          {person.initial}
                        </span>
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  <AvatarGroupCount>+{collaborators.length - 2}</AvatarGroupCount>
                </AvatarGroup>
                <span className="i-ri-arrow-down-s-line size-3 text-text-tertiary" />
              </span>
            </IconButton>
          }
        />
        <DropdownMenuContent>
          {collaborators.map((person) => (
            <DropdownMenuLinkItem key={person.name} href={person.href}>
              <Avatar size="sm" aria-hidden="true">
                <AvatarFallback className={person.color}>{person.initial}</AvatarFallback>
              </Avatar>
              {person.name}
            </DropdownMenuLinkItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'View 4 collaborators' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const body = within(canvasElement.ownerDocument.body)
    const firstCollaborator = await body.findByRole('menuitem', { name: 'Emma' })
    await waitFor(() => expect(firstCollaborator).toBeVisible())
    await waitFor(() => expect(firstCollaborator).toHaveFocus())
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(firstCollaborator).not.toBeVisible())
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  },
}
