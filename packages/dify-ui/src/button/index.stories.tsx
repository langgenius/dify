import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, fn } from 'storybook/test'
import { Button, buttonVariants } from '.'

const meta = {
  title: 'Base/UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    loading: { control: 'boolean' },
    focusableWhenDisabled: { control: 'boolean' },
    tone: {
      control: 'select',
      options: ['default', 'destructive'],
    },
    disabled: { control: 'boolean' },
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'secondary-accent', 'ghost', 'ghost-accent', 'tertiary'],
    },
    size: {
      control: 'select',
      options: ['small', 'medium', 'large'],
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
    children: 'Primary Button',
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
    onClick: fn(),
    children: 'Loading Button',
  },
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Loading Button' })

    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(button).not.toHaveAttribute('aria-busy')

    button.focus()
    await expect(button).toHaveFocus()

    await userEvent.click(button)
    await expect(args.onClick).not.toHaveBeenCalled()
  },
  parameters: {
    docs: {
      description: {
        story:
          'Loading buttons remain focusable by default so focus is not lost after activation. Pass `focusableWhenDisabled={false}` to opt out.',
      },
    },
  },
}

export const Destructive: Story = {
  args: {
    variant: 'primary',
    tone: 'destructive',
    children: 'Delete',
  },
}

export const WithIcon: Story = {
  args: {
    variant: 'primary',
    children: (
      <React.Fragment>
        <span aria-hidden className="mr-1.5 i-ri-rocket-line size-4 shrink-0" />
        Launch
      </React.Fragment>
    ),
  },
}

export const SmallSize: Story = {
  args: {
    variant: 'secondary',
    size: 'small',
    children: 'Small',
  },
}

export const LargeSize: Story = {
  args: {
    variant: 'primary',
    size: 'large',
    children: 'Large Button',
  },
}

export const StyledLink: Story = {
  render: () => (
    <a className={buttonVariants({ variant: 'ghost-accent' })} href="https://example.com">
      Link styled as a button
    </a>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Link styled as a button' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
  },
  parameters: {
    docs: {
      description: {
        story:
          'Rendering an anchor through `Button` is an anti-pattern because Base UI enforces button semantics. Keep the native link and apply `buttonVariants` directly when a link needs button styling. See the [Base UI Button usage guidelines](https://base-ui.com/react/components/button#rendering-links-as-buttons).',
      },
    },
  },
}
