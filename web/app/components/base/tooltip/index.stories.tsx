import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import Tooltip from '.'

const TooltipGrid = () => {
  return (
    <div className="flex w-full max-w-xl flex-col gap-6 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Hover tooltips</div>
      <div className="flex flex-wrap gap-4">
        <Tooltip popupContent="Helpful hint explaining the setting.">
          <button
            type="button"
            className="rounded-md border border-divider-subtle bg-background-default px-3 py-1 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
          >
            Hover me
          </button>
        </Tooltip>
        <Tooltip popupContent="Placement can vary." position="right">
          <span className="rounded-md bg-background-default px-3 py-1 text-xs text-text-secondary">
            Right tooltip
          </span>
        </Tooltip>
      </div>
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Click tooltips</div>
      <div className="flex flex-wrap gap-4">
        <Tooltip popupContent="Click again to close." triggerMethod="click" position="bottom-start">
          <button
            type="button"
            className="rounded-md border border-divider-subtle bg-background-default px-3 py-1 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
          >
            Click trigger
          </button>
        </Tooltip>
        <Tooltip popupContent="Decoration disabled" triggerMethod="click" noDecoration>
          <span className="rounded-md border border-dashed border-divider-regular px-3 py-1 text-xs text-text-secondary">
            Plain content
          </span>
        </Tooltip>
      </div>
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/Tooltip',
  component: TooltipGrid,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Portal-based tooltip component supporting hover and click triggers, custom placements, and decorated content.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TooltipGrid>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
