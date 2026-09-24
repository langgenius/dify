import type { Meta, StoryObj } from '@storybook/react-vite'
import type { TooltipContentProps } from '.'
import * as React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '.'
import { IconButton as DifyIconButton } from '../icon-button'

const triggerButtonClassName =
  'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'

const meta = {
  title: 'Base/UI/Tooltip',
  component: Tooltip,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compound tooltip built on Base UI Tooltip. Wrap the app in `TooltipProvider` so nested tooltips share open and close delays. Each tooltip pairs a `TooltipTrigger` with `TooltipContent` and supports placement and offsets.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

const ICON_ACTIONS = [
  { icon: 'i-ri-pencil-line', label: 'Edit' },
  { icon: 'i-ri-file-copy-line', label: 'Duplicate' },
  { icon: 'i-ri-archive-line', label: 'Archive' },
  { icon: 'i-ri-delete-bin-line', label: 'Delete' },
] as const

export const IconButton: Story = {
  name: 'Icon button (canonical)',
  parameters: {
    docs: {
      description: {
        story:
          'Icon-only actions keep their own accessible name while the tooltip provides the matching visual label.',
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-3">
      {ICON_ACTIONS.map(({ icon, label }) => (
        <Tooltip key={label}>
          <TooltipTrigger
            render={
              <DifyIconButton aria-label={label} size="lg" variant="secondary">
                <span aria-hidden className={`${icon} size-4`} />
              </DifyIconButton>
            }
          />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
}

export const KeyboardShortcut: Story = {
  parameters: {
    docs: {
      description: {
        story: 'A visible button label can use a tooltip for a supplementary keyboard shortcut.',
      },
    },
  },
  render: () => (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" className={triggerButtonClassName}>
            Save
          </button>
        }
      />
      <TooltipContent>⌘S</TooltipContent>
    </Tooltip>
  ),
}

type TooltipPlacement = NonNullable<TooltipContentProps['placement']>

const PLACEMENTS: TooltipPlacement[] = [
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
  const [placement, setPlacement] = React.useState<TooltipPlacement>('top')

  return (
    <div className="flex flex-col items-center gap-4 p-24">
      <div className="grid grid-cols-3 gap-2 text-xs">
        {PLACEMENTS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setPlacement(value)}
            className={`rounded-md border border-divider-subtle px-2 py-1 text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden ${
              placement === value ? 'bg-state-base-hover' : 'bg-components-button-secondary-bg'
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <Tooltip open>
        <TooltipTrigger
          render={
            <DifyIconButton aria-label="Placement anchor" size="lg" variant="secondary">
              <span aria-hidden className="i-ri-pushpin-line size-4" />
            </DifyIconButton>
          }
        />
        <TooltipContent placement={placement}>{`placement="${placement}"`}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export const Placements: Story = {
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          'Placement reference. `placement` accepts the 12 standard side/align combinations; Base UI flips automatically if the tooltip would overflow the viewport.',
      },
    },
  },
  render: () => <PlacementsDemo />,
}

const DELAY_PRESETS: Array<{ label: string; delay: number }> = [
  { label: 'Instant', delay: 0 },
  { label: 'Fast', delay: 150 },
  { label: 'Default', delay: 600 },
]

const DelayDemo = () => (
  <div className="flex items-center gap-3">
    {DELAY_PRESETS.map(({ label, delay }) => (
      <TooltipProvider key={delay} delay={delay}>
        <Tooltip>
          <TooltipTrigger
            render={
              <DifyIconButton aria-label={`${label} (${delay}ms)`} size="lg" variant="secondary">
                <span aria-hidden className="i-ri-timer-line size-4" />
              </DifyIconButton>
            }
          />
          <TooltipContent>{`${label} (${delay}ms)`}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ))}
  </div>
)

export const WithDelay: Story = {
  parameters: {
    docs: {
      description: {
        story:
          '`TooltipProvider` shares hover `delay` and `closeDelay` settings among nested tooltips. This example uses a separate provider for each delay preset. See the [Base UI Provider reference](https://base-ui.com/react/components/tooltip#provider) for timing and grouping behavior.',
      },
    },
  },
  render: () => <DelayDemo />,
}
