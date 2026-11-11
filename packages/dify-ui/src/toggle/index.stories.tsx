import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toggle } from '.'
import { Button } from '../button'
import { IconButton } from '../icon-button'

const accentPressedClassName =
  'data-pressed:bg-state-accent-active data-pressed:text-text-accent data-pressed:hover:bg-state-accent-active-alt'
const destructivePressedClassName =
  'data-pressed:bg-state-destructive-hover data-pressed:text-text-destructive data-pressed:hover:bg-state-destructive-hover data-pressed:hover:text-text-destructive'

const meta = {
  title: 'Base/UI/Toggle',
  component: Toggle,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Thin re-export of Base UI Toggle. Compose it with Button or IconButton through render and style its data-pressed state at the owning feature.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const IconToggle: Story = {
  render: () => (
    <Toggle
      className={accentPressedClassName}
      render={
        <IconButton aria-label="Favorite">
          <span aria-hidden="true" className="i-ri-star-line size-4" />
        </IconButton>
      }
    />
  ),
}

export const DestructiveIconToggle: Story = {
  render: () => (
    <Toggle
      className={destructivePressedClassName}
      render={
        <IconButton aria-label="Dislike">
          <span aria-hidden="true" className="i-ri-thumb-down-line size-4" />
        </IconButton>
      }
    />
  ),
}

export const TextToggle: Story = {
  render: () => (
    <Toggle
      className={accentPressedClassName}
      defaultPressed
      render={<Button size="small" variant="tertiary" />}
    >
      Pin to sidebar
    </Toggle>
  ),
}
