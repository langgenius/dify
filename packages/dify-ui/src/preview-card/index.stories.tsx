import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Placement } from '.'
import { useState } from 'react'
import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '.'

const rowButtonClassName
  = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-state-base-hover'

const triggerButtonClassName
  = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover'

const meta = {
  title: 'Base/UI/PreviewCard',
  component: PreviewCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Hover- and focus-activated rich preview for triggers whose primary click has its own destination (selecting a row, jumping to a definition, following a link). Built on Base UI PreviewCard.\n\n**A11y contract:** touch and screen-reader users cannot open the preview. Never place information or actions in the popup that are not also reachable from the trigger\'s primary click destination. If that is unavoidable, add a separate click affordance (Popover) or move the unique content onto the destination.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof PreviewCard>

export default meta
type Story = StoryObj<typeof meta>

export const Supplementary: Story = {
  name: 'Supplementary preview (recommended)',
  render: () => (
    <PreviewCard>
      <PreviewCardTrigger
        render={(
          <button type="button" className={rowButtonClassName}>
            <span className="i-ri-sparkling-fill h-4 w-4 text-text-accent" />
            <span>gpt-4o</span>
          </button>
        )}
      />
      <PreviewCardContent
        placement="right"
        popupClassName="w-[220px] p-3"
      >
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-text-primary">gpt-4o</div>
          <div className="text-xs text-text-tertiary">
            Multimodal flagship model. Vision, audio and 128k context.
          </div>
        </div>
      </PreviewCardContent>
    </PreviewCard>
  ),
}

const PLACEMENTS: Placement[] = [
  'top-start',
  'top',
  'top-end',
  'right-start',
  'right',
  'right-end',
  'bottom-start',
  'bottom',
  'bottom-end',
  'left-start',
  'left',
  'left-end',
]

const PlacementsDemo = () => {
  const [placement, setPlacement] = useState<Placement>('bottom')

  return (
    <div className="flex flex-col items-center gap-4 p-20">
      <div className="grid grid-cols-3 gap-2 text-xs">
        {PLACEMENTS.map(value => (
          <button
            key={value}
            type="button"
            onClick={() => setPlacement(value)}
            className={`rounded-md border border-divider-subtle px-2 py-1 text-text-secondary ${
              placement === value ? 'bg-state-base-hover' : 'bg-components-button-secondary-bg'
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <PreviewCard open>
        <PreviewCardTrigger
          render={<button type="button" className={triggerButtonClassName}>Hover me</button>}
        />
        <PreviewCardContent placement={placement} popupClassName="w-56 p-3">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-semibold text-text-primary">
              placement="
              {placement}
              "
            </div>
            <div className="text-xs text-text-secondary">
              Preview positions itself relative to the trigger.
            </div>
          </div>
        </PreviewCardContent>
      </PreviewCard>
    </div>
  )
}

export const Placements: Story = {
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <PlacementsDemo />,
}

const CustomDelayDemo = () => (
  <PreviewCard>
    <PreviewCardTrigger
      delay={100}
      closeDelay={100}
      render={<button type="button" className={triggerButtonClassName}>Snappy trigger</button>}
    />
    <PreviewCardContent popupClassName="w-64 p-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-text-primary">Fast hover</div>
        <div className="text-xs text-text-secondary">
          Base UI defaults (600ms / 300ms) are tuned for link previews. Override per trigger for denser UIs.
        </div>
      </div>
    </PreviewCardContent>
  </PreviewCard>
)

export const CustomDelays: Story = {
  render: () => <CustomDelayDemo />,
}
