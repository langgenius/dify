import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconButton } from '.'

const meta = {
  title: 'Base/UI/IconButton',
  component: IconButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Icon-only command button built on Base UI Button. Provide one icon element and an accessible name.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'primary',
        'secondary',
        'secondary-accent',
        'tertiary',
        'ghost',
        'ghost-accent',
      ],
    },
    tone: {
      control: 'select',
      options: ['default', 'destructive'],
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
    disabled: { control: 'boolean' },
  },
  args: {
    'aria-label': 'Information',
    children: <span aria-hidden="true" className="i-ri-information-2-line size-4" />,
  },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const CSSIcon: Story = {
  args: {
    'aria-label': 'Close',
    children: <span aria-hidden="true" className="i-ri-close-line size-4" />,
  },
}

export const ReactSVGIcon: Story = {
  args: {
    'aria-label': 'Add',
    children: (
      <svg
        aria-hidden="true"
        className="size-4"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
      >
        <path d="M8 3v10M3 8h10" strokeLinecap="round" />
      </svg>
    ),
  },
}

export const DestructiveIntent: Story = {
  args: {
    'aria-label': 'Delete',
    tone: 'destructive',
    children: <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />,
  },
  parameters: {
    docs: {
      description: {
        story: 'Destructive intent appears on hover while the resting action remains neutral.',
      },
    },
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}

export const Sizes: Story = {
  render: () => {
    const sizes = [
      { button: 'xs', icon: 'size-3.5' },
      { button: 'sm', icon: 'size-4' },
      { button: 'md', icon: 'size-4' },
      { button: 'lg', icon: 'size-4' },
      { button: 'xl', icon: 'size-5' },
    ] as const

    return (
      <div className="flex items-center gap-3">
        {sizes.map(({ button, icon }) => (
          <IconButton key={button} aria-label={`${button} icon button`} size={button}>
            <span aria-hidden="true" className={`i-ri-information-2-line ${icon}`} />
          </IconButton>
        ))}
      </div>
    )
  },
}

export const Appearances: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(
        [
          'default',
          'primary',
          'secondary',
          'secondary-accent',
          'tertiary',
          'ghost',
          'ghost-accent',
        ] as const
      ).map((variant) => (
        <IconButton key={variant} aria-label={`${variant} icon button`} variant={variant}>
          <span aria-hidden="true" className="i-ri-information-2-line size-4" />
        </IconButton>
      ))}
    </div>
  ),
}
