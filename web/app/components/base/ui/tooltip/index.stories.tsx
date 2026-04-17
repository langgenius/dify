import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { Placement } from '../placement'
import { useState } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '.'

const triggerButtonClassName = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover'
const iconButtonClassName = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-divider-subtle bg-components-button-secondary-bg text-text-secondary shadow-xs hover:bg-state-base-hover'

const meta = {
  title: 'Base/UI/Tooltip',
  component: Tooltip,
  decorators: [
    Story => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound tooltip built on Base UI Tooltip. Wrap the app in `TooltipProvider` (done automatically in these stories) so multiple tooltips share open/close delays. Each tooltip pairs a `TooltipTrigger` with a `TooltipContent` and supports placement, offsets, and two style variants.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Hover me
      </TooltipTrigger>
      <TooltipContent>
        Tooltips describe interactive elements without a click.
      </TooltipContent>
    </Tooltip>
  ),
}

export const Plain: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Use `variant="plain"` to render the popup without default chrome (background, padding, typography). Apply your own styling via `className` on `TooltipContent`.',
      },
    },
  },
  render: () => (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Preview details
      </TooltipTrigger>
      <TooltipContent
        variant="plain"
        className="rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-lg"
      >
        <div className="flex w-64 flex-col gap-1">
          <span className="text-sm font-semibold text-text-primary">Dataset preview</span>
          <span className="text-xs text-text-secondary">
            32 documents • Last indexed 2 minutes ago
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
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
  const [placement, setPlacement] = useState<Placement>('top')

  return (
    <div className="flex flex-col items-center gap-4 p-24">
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
      <Tooltip open>
        <TooltipTrigger
          render={<button type="button" className={triggerButtonClassName} />}
        >
          Anchor
        </TooltipTrigger>
        <TooltipContent placement={placement}>
          placement="
          {placement}
          "
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export const Placements: Story = {
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <PlacementsDemo />,
}

export const OnIconButtons: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Tooltips are essential for icon-only buttons. The trigger is the button; the tooltip provides the accessible label and hover hint.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-3">
      <Tooltip>
        <TooltipTrigger
          render={(
            <button type="button" aria-label="Edit" className={iconButtonClassName}>
              <span aria-hidden className="i-ri-pencil-line h-4 w-4" />
            </button>
          )}
        />
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={(
            <button type="button" aria-label="Duplicate" className={iconButtonClassName}>
              <span aria-hidden className="i-ri-file-copy-line h-4 w-4" />
            </button>
          )}
        />
        <TooltipContent>Duplicate</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={(
            <button type="button" aria-label="Archive" className={iconButtonClassName}>
              <span aria-hidden className="i-ri-archive-line h-4 w-4" />
            </button>
          )}
        />
        <TooltipContent>Archive</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={(
            <button type="button" aria-label="Delete" className={iconButtonClassName}>
              <span aria-hidden className="i-ri-delete-bin-line h-4 w-4" />
            </button>
          )}
        />
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
    </div>
  ),
}

export const LongContent: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        What are tokens?
      </TooltipTrigger>
      <TooltipContent>
        Tokens are the basic units a model reads. English text averages ~4 characters per token; non-Latin scripts often use more tokens per character. Both input and output count toward your quota.
      </TooltipContent>
    </Tooltip>
  ),
}

const DELAY_PRESETS: Array<{ label: string, delay: number }> = [
  { label: 'Instant (0ms)', delay: 0 },
  { label: 'Fast (150ms)', delay: 150 },
  { label: 'Default (600ms)', delay: 600 },
]

const DelayDemo = () => {
  return (
    <div className="flex items-center gap-3">
      {DELAY_PRESETS.map(({ label, delay }) => (
        <TooltipProvider key={delay} delay={delay}>
          <Tooltip>
            <TooltipTrigger
              render={<button type="button" className={triggerButtonClassName} />}
            >
              {label}
            </TooltipTrigger>
            <TooltipContent>
              Appeared after
              {delay}
              ms hover delay.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  )
}

export const WithDelay: Story = {
  parameters: {
    docs: {
      description: {
        story: '`TooltipProvider` controls hover `delay` (and `closeDelay`) for the tooltips nested inside it. Adjacent tooltips under the same provider open instantly after the first has been shown.',
      },
    },
  },
  render: () => <DelayDemo />,
}
