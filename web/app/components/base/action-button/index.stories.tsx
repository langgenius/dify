import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import ActionButton, { ActionButtonState } from '.'

const meta = {
  title: 'Base/General/ActionButton',
  component: ActionButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Action button component with multiple sizes and states. Commonly used for toolbar actions and inline operations.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'm', 'l', 'xl'],
      description: 'Button size',
    },
    state: {
      control: 'select',
      options: [
        ActionButtonState.Default,
        ActionButtonState.Active,
        ActionButtonState.Disabled,
        ActionButtonState.Destructive,
        ActionButtonState.Hover,
      ],
      description: 'Button state',
    },
    children: {
      control: 'text',
      description: 'Button content',
    },
    disabled: {
      control: 'boolean',
      description: 'Native disabled state',
    },
  },
} satisfies Meta<typeof ActionButton>

export default meta
type Story = StoryObj<typeof meta>

// Default state
export const Default: Story = {
  args: {
    size: 'm',
    children: <span className="i-ri-edit-line h-4 w-4" />,
  },
}

// With text
export const WithText: Story = {
  args: {
    size: 'm',
    children: 'Edit',
  },
}

// Icon with text
export const IconWithText: Story = {
  args: {
    size: 'm',
    children: (
      <>
        <span className="i-ri-add-line mr-1 h-4 w-4" />
        Add Item
      </>
    ),
  },
}

// Size variations
export const ExtraSmall: Story = {
  args: {
    size: 'xs',
    children: <span className="i-ri-edit-line h-3 w-3" />,
  },
}

export const Small: Story = {
  args: {
    size: 'xs',
    children: <span className="i-ri-edit-line h-3.5 w-3.5" />,
  },
}

export const Medium: Story = {
  args: {
    size: 'm',
    children: <span className="i-ri-edit-line h-4 w-4" />,
  },
}

export const Large: Story = {
  args: {
    size: 'l',
    children: <span className="i-ri-edit-line h-5 w-5" />,
  },
}

export const ExtraLarge: Story = {
  args: {
    size: 'xl',
    children: <span className="i-ri-edit-line h-6 w-6" />,
  },
}

// State variations
export const ActiveState: Story = {
  args: {
    size: 'm',
    state: ActionButtonState.Active,
    children: <span className="i-ri-edit-line h-4 w-4" />,
  },
}

export const DisabledState: Story = {
  args: {
    size: 'm',
    state: ActionButtonState.Disabled,
    children: <span className="i-ri-edit-line h-4 w-4" />,
  },
}

export const DestructiveState: Story = {
  args: {
    size: 'm',
    state: ActionButtonState.Destructive,
    children: <span className="i-ri-delete-bin-line h-4 w-4" />,
  },
}

export const HoverState: Story = {
  args: {
    size: 'm',
    state: ActionButtonState.Hover,
    children: <span className="i-ri-edit-line h-4 w-4" />,
  },
}

// Real-world examples
export const ToolbarActions: Story = {
  render: () => (
    <div className="flex items-center gap-1 rounded-lg bg-background-section-burn p-2">
      <ActionButton size="m">
        <span className="i-ri-edit-line h-4 w-4" />
      </ActionButton>
      <ActionButton size="m">
        <span className="i-ri-share-line h-4 w-4" />
      </ActionButton>
      <ActionButton size="m">
        <span className="i-ri-save-line h-4 w-4" />
      </ActionButton>
      <div className="mx-1 h-4 w-px bg-divider-regular" />
      <ActionButton size="m" state={ActionButtonState.Destructive}>
        <span className="i-ri-delete-bin-line h-4 w-4" />
      </ActionButton>
    </div>
  ),
}

export const InlineActions: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <span className="text-text-secondary">Item name</span>
      <ActionButton size="xs">
        <span className="i-ri-edit-line h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton size="xs">
        <span className="i-ri-more-2-fill h-3.5 w-3.5" />
      </ActionButton>
    </div>
  ),
}

export const SizeComparison: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="xs">
          <span className="i-ri-edit-line h-3 w-3" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">XS</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="xs">
          <span className="i-ri-edit-line h-3.5 w-3.5" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">S</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="m">
          <span className="i-ri-edit-line h-4 w-4" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">M</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="l">
          <span className="i-ri-edit-line h-5 w-5" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">L</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="xl">
          <span className="i-ri-edit-line h-6 w-6" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">XL</span>
      </div>
    </div>
  ),
}

export const StateComparison: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="m" state={ActionButtonState.Default}>
          <span className="i-ri-edit-line h-4 w-4" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">Default</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="m" state={ActionButtonState.Active}>
          <span className="i-ri-edit-line h-4 w-4" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">Active</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="m" state={ActionButtonState.Hover}>
          <span className="i-ri-edit-line h-4 w-4" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">Hover</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="m" state={ActionButtonState.Disabled}>
          <span className="i-ri-edit-line h-4 w-4" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">Disabled</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <ActionButton size="m" state={ActionButtonState.Destructive}>
          <span className="i-ri-delete-bin-line h-4 w-4" />
        </ActionButton>
        <span className="text-xs text-text-tertiary">Destructive</span>
      </div>
    </div>
  ),
}

// Interactive playground
export const Playground: Story = {
  args: {
    size: 'm',
    state: ActionButtonState.Default,
    children: <span className="i-ri-edit-line h-4 w-4" />,
  },
}
