import type { Meta, StoryObj } from '@storybook/nextjs'

import { RocketLaunchIcon } from '@heroicons/react/20/solid'
import { Button } from '.'

const meta = {
  title: 'Base/General/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    loading: { control: 'boolean' },
    variant: {
      control: 'select',
      options: ['primary', 'warning', 'secondary', 'secondary-accent', 'ghost', 'ghost-accent', 'tertiary'],
    },
  },
  args: {
    variant: 'ghost',
    children: 'Button',
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    variant: 'primary',
    loading: false,
    children: 'Primary Button',
    styleCss: {},
    spinnerClassName: '',
    destructive: false,
  },
}

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary Button',
  },
}

export const SecondaryAccent: Story = {
  args: {
    variant: 'secondary-accent',
    children: 'Secondary Accent Button',
  },
}

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost Button',
  },
}

export const GhostAccent: Story = {
  args: {
    variant: 'ghost-accent',
    children: 'Ghost Accent Button',
  },
}

export const Tertiary: Story = {
  args: {
    variant: 'tertiary',
    children: 'Tertiary Button',
  },
}

export const Warning: Story = {
  args: {
    variant: 'warning',
    children: 'Warning Button',
  },
}

export const Disabled: Story = {
  args: {
    variant: 'primary',
    disabled: true,
    children: 'Disabled Button',
  },
}

export const Loading: Story = {
  args: {
    variant: 'primary',
    loading: true,
    children: 'Loading Button',
  },
}

export const WithIcon: Story = {
  args: {
    variant: 'primary',
    children: (
      <>
        <RocketLaunchIcon className="mr-1.5 h-4 w-4 stroke-[1.8px]" />
        Launch
      </>
    ),
  },
}
