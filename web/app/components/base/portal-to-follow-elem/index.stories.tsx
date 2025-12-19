import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '.'

const TooltipCard = ({ title, description }: { title: string; description: string }) => (
  <div className="w-[220px] rounded-lg border border-divider-subtle bg-components-panel-bg px-3 py-2 text-sm text-text-secondary shadow-lg">
    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
      {title}
    </div>
    <p className="leading-5">{description}</p>
  </div>
)

const PortalDemo = ({
  placement = 'bottom',
  triggerPopupSameWidth = false,
}: {
  placement?: Parameters<typeof PortalToFollowElem>[0]['placement']
  triggerPopupSameWidth?: boolean
}) => {
  const [controlledOpen, setControlledOpen] = useState(false)

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="flex flex-wrap items-center gap-4">
        <PortalToFollowElem placement={placement} triggerPopupSameWidth={triggerPopupSameWidth}>
          <PortalToFollowElemTrigger className="rounded-md border border-divider-subtle bg-background-default px-3 py-2 text-sm text-text-secondary">
            Hover me
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className="z-40">
            <TooltipCard
              title="Auto follow"
              description="The floating element repositions itself when the trigger moves, using Floating UI under the hood."
            />
          </PortalToFollowElemContent>
        </PortalToFollowElem>

        <PortalToFollowElem
          placement="bottom-start"
          triggerPopupSameWidth
          open={controlledOpen}
          onOpenChange={setControlledOpen}
        >
          <PortalToFollowElemTrigger asChild>
            <button
              type="button"
              className="rounded-md border border-divider-subtle bg-background-default-subtle px-3 py-2 text-sm font-medium text-text-secondary hover:bg-state-base-hover"
              onClick={() => setControlledOpen(prev => !prev)}
            >
              Controlled toggle
            </button>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className="z-40">
            <TooltipCard
              title="Controlled"
              description="This panel uses the controlled API via onOpenChange/open props, and matches the trigger width."
            />
          </PortalToFollowElemContent>
        </PortalToFollowElem>
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/PortalToFollowElem',
  component: PortalDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Floating UI based portal that tracks trigger positioning. Demonstrates both hover-driven and controlled usage.',
      },
    },
  },
  argTypes: {
    placement: {
      control: 'select',
      options: ['top', 'top-start', 'top-end', 'bottom', 'bottom-start', 'bottom-end'],
    },
    triggerPopupSameWidth: { control: 'boolean' },
  },
  args: {
    placement: 'bottom',
    triggerPopupSameWidth: false,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PortalDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const SameWidthPanel: Story = {
  args: {
    triggerPopupSameWidth: true,
  },
}
