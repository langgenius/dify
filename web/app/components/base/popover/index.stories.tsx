import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import CustomPopover from '.'

type PopoverContentProps = {
  open?: boolean
  onClose?: () => void
  onClick?: () => void
  title: string
  description: string
}

const PopoverContent = ({ title, description, onClose }: PopoverContentProps) => {
  return (
    <div className="flex min-w-[220px] flex-col gap-2 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-text-tertiary">
        {title}
      </div>
      <p className="text-sm leading-5 text-text-secondary">{description}</p>
      <button
        type="button"
        className="self-start rounded-md border border-divider-subtle px-2 py-1 text-xs font-medium text-text-tertiary hover:bg-state-base-hover"
        onClick={onClose}
      >
        Dismiss
      </button>
    </div>
  )
}

const Template = ({
  trigger = 'hover',
  position = 'bottom',
  manualClose,
  disabled,
}: {
  trigger?: 'click' | 'hover'
  position?: 'bottom' | 'bl' | 'br'
  manualClose?: boolean
  disabled?: boolean
}) => {
  const [hoverHint] = useState(
    trigger === 'hover'
      ? 'Hover over the badge to reveal quick tips.'
      : 'Click the badge to open the contextual menu.',
  )

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <p className="text-sm text-text-secondary">{hoverHint}</p>
      <div className="flex flex-wrap items-center gap-6">
        <CustomPopover
          trigger={trigger}
          position={position}
          manualClose={manualClose}
          disabled={disabled}
          btnElement={<span className="text-xs font-medium text-text-secondary">Popover trigger</span>}
          htmlContent={(
            <PopoverContent
              title={trigger === 'hover' ? 'Quick help' : 'More actions'}
              description={trigger === 'hover'
                ? 'Use hover-triggered popovers for light contextual hints and inline docs.'
                : 'Click-triggered popovers are ideal for menus that require user decisions.'}
            />
          )}
        />
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/Popover',
  component: Template,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Headless UI popover wrapper supporting hover and click triggers. These examples highlight alignment controls and manual closing.',
      },
    },
  },
  argTypes: {
    trigger: {
      control: 'radio',
      options: ['hover', 'click'],
    },
    position: {
      control: 'radio',
      options: ['bottom', 'bl', 'br'],
    },
    manualClose: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: {
    trigger: 'hover',
    position: 'bottom',
    manualClose: false,
    disabled: false,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Template>

export default meta
type Story = StoryObj<typeof meta>

export const HoverPopover: Story = {}

export const ClickPopover: Story = {
  args: {
    trigger: 'click',
    position: 'br',
  },
}

export const DisabledState: Story = {
  args: {
    disabled: true,
  },
}
