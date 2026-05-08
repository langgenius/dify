import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Placement } from '.'
import { Button } from '@langgenius/dify-ui/button'
import { useState } from 'react'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '.'

const triggerButtonClassName = 'rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 text-sm text-text-secondary shadow-xs hover:bg-state-base-hover'

const meta = {
  title: 'Base/UI/Popover',
  component: Popover,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Compound popover built on Base UI Popover. Use it for contextual affordances, overflow menus, filters, and forms that anchor to a trigger. Control placement via the `placement` prop on `PopoverContent` and compose arbitrary children inside the popup.\n\nPass `openOnHover` on `PopoverTrigger` when the popup should also reveal on hover (see the **Infotip** story). Unlike `Tooltip` and `PreviewCard`, hover on `Popover` still falls back to tap/focus, so touch and screen-reader users can reach the content.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Open popover
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex w-72 flex-col gap-2 p-4">
          <PopoverTitle className="text-sm font-semibold text-text-primary">
            Keyboard shortcuts
          </PopoverTitle>
          <PopoverDescription className="text-xs text-text-secondary">
            Press
            {' '}
            <kbd className="rounded bg-background-default-subtle px-1 py-0.5 font-mono text-[11px]">⌘</kbd>
            {' '}
            +
            {' '}
            <kbd className="rounded bg-background-default-subtle px-1 py-0.5 font-mono text-[11px]">K</kbd>
            {' '}
            to open the command palette anywhere in the app.
          </PopoverDescription>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

export const WithActions: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger
        render={<button type="button" className={triggerButtonClassName} />}
      >
        Share workspace
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex w-80 flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <PopoverTitle className="text-sm font-semibold text-text-primary">
              Share workspace
            </PopoverTitle>
            <PopoverDescription className="text-xs text-text-secondary">
              Invite collaborators by email. They will get a pending invitation in their inbox.
            </PopoverDescription>
          </div>
          <input
            type="email"
            placeholder="teammate@example.com"
            className="h-8 rounded-md border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-2 text-sm text-components-input-text-filled outline-hidden placeholder:text-components-input-text-placeholder focus:border-components-input-border-hover"
          />
          <div className="flex items-center justify-end gap-2">
            <PopoverClose
              render={<Button variant="secondary" size="small" />}
            >
              Cancel
            </PopoverClose>
            <PopoverClose
              render={<Button variant="primary" size="small" />}
            >
              Send invite
            </PopoverClose>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

export const Infotip: Story = {
  parameters: {
    docs: {
      description: {
        story: [
          'The **infotip** pattern from [Base UI](https://base-ui.com/react/components/tooltip#infotips): an info glyph (`?`, `(i)`) whose sole purpose is to reveal explanatory text. Use `Popover` with `openOnHover` on the trigger — never `Tooltip`.',
          '',
          'Why not `Tooltip`? Tooltips are disabled on touch devices and not announced to screen readers; descriptive help text hidden in them is unreachable for those users. Why not `PreviewCard`? PreviewCard\'s a11y contract requires the trigger to already own a primary click destination, but an info glyph has no other purpose.',
          '',
          'Base UI rule of thumb: *"If the trigger\'s purpose is to open the popup itself, it\'s a popover. If the trigger\'s purpose is unrelated to opening the popup, it\'s a tooltip."*',
          '',
          'Hover, tap, or focus the `?` icon to open. In the Dify app, reach for `@/app/components/base/infotip` (`<Infotip aria-label={...}>{helpText}</Infotip>`) which wraps this pattern with consistent delays (300/200), typography, and `aria-label` plumbing.',
        ].join('\n'),
      },
    },
  },
  render: () => (
    <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
      <span>Usage priority</span>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={300}
          closeDelay={200}
          aria-label="Set which resource to use first when running models."
          render={(
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
              <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
            </span>
          )}
        />
        <PopoverContent
          placement="top"
          popupClassName="max-w-[300px] px-3 py-2 system-xs-regular text-text-tertiary"
        >
          Set which resource to use first when running models. The Trial quota will be used after the paid quota is exhausted.
        </PopoverContent>
      </Popover>
    </div>
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
      <Popover open>
        <PopoverTrigger
          render={<button type="button" className={triggerButtonClassName} />}
        >
          Anchored trigger
        </PopoverTrigger>
        <PopoverContent placement={placement}>
          <div className="flex w-56 flex-col gap-1 p-3">
            <PopoverTitle className="text-sm font-semibold text-text-primary">
              placement="
              {placement}
              "
            </PopoverTitle>
            <PopoverDescription className="text-xs text-text-secondary">
              Popover positions itself relative to the trigger using the selected placement.
            </PopoverDescription>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export const Placements: Story = {
  parameters: {
    layout: 'fullscreen',
  },
  render: () => <PlacementsDemo />,
}

const ControlledDemo = () => {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" onClick={() => setOpen(prev => !prev)}>
        {open ? 'Close from outside' : 'Open from outside'}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<button type="button" className={triggerButtonClassName} />}
        >
          Anchor
        </PopoverTrigger>
        <PopoverContent>
          <div className="flex w-64 flex-col gap-2 p-4">
            <PopoverTitle className="text-sm font-semibold text-text-primary">
              Controlled popover
            </PopoverTitle>
            <PopoverDescription className="text-xs text-text-secondary">
              Open state is owned by the parent. The trigger and the external button both toggle it.
            </PopoverDescription>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}
