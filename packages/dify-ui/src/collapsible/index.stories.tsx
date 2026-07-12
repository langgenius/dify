import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '.'
import { cn } from '../cn'

const meta = {
  title: 'Base/UI/Collapsible',
  component: Collapsible,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Unstyled Base UI Collapsible primitive. The examples mirror the official Root, Trigger, and Panel anatomy, with presentation supplied at the call site using Dify UI tokens.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

const rootClassName = 'w-72 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg shadow-shadow-shadow-5'
const triggerClassName = 'h-8'
const panelClassName = 'system-sm-regular text-text-secondary'
const contentClassName = 'flex flex-col gap-2 px-2.5 pb-2 pt-1'
const iconClassName = 'i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary transition-transform duration-100 ease-out group-data-panel-open:rotate-90 motion-reduce:transition-none'
const sectionRootClassName = 'w-90 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg shadow-shadow-shadow-5'
const sectionTriggerClassName = cn(
  triggerClassName,
  'h-auto min-h-12 px-3 py-2',
)
const sectionPanelClassName = panelClassName

function TriggerIcon() {
  return <span aria-hidden="true" className={iconClassName} />
}

function RecoveryKeys({
  panelProps,
}: {
  panelProps?: React.ComponentProps<typeof CollapsiblePanel>
}) {
  return (
    <React.Fragment>
      <CollapsibleTrigger className={triggerClassName}>
        Recovery keys
        <TriggerIcon />
      </CollapsibleTrigger>
      <CollapsiblePanel className={panelClassName} {...panelProps}>
        <div className={contentClassName}>
          <div>alien-bean-pasta</div>
          <div>wild-irish-burrito</div>
          <div>horse-battery-staple</div>
        </div>
      </CollapsiblePanel>
    </React.Fragment>
  )
}

export const Anatomy: Story = {
  args: {
    defaultOpen: true,
  },
  render: args => (
    <Collapsible {...args} className={rootClassName}>
      <RecoveryKeys />
    </Collapsible>
  ),
}

export const DefaultClosed: Story = {
  render: () => (
    <Collapsible className={rootClassName}>
      <RecoveryKeys />
    </Collapsible>
  ),
}

export const DefaultOpen: Story = {
  render: () => (
    <Collapsible defaultOpen className={rootClassName}>
      <RecoveryKeys />
    </Collapsible>
  ),
}

function ControlledDemo() {
  const [open, setOpen] = React.useState(true)

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        className="rounded-lg border border-divider-subtle bg-components-button-secondary-bg px-3 py-1.5 system-sm-medium text-components-button-secondary-text shadow-xs shadow-shadow-shadow-3 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={() => setOpen(value => !value)}
      >
        {open ? 'Close panel' : 'Open panel'}
      </button>
      <Collapsible open={open} onOpenChange={setOpen} className={rootClassName}>
        <RecoveryKeys />
      </Collapsible>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}

export const Disabled: Story = {
  render: () => (
    <Collapsible disabled className={rootClassName}>
      <RecoveryKeys />
    </Collapsible>
  ),
}

export const KeepMounted: Story = {
  render: () => (
    <Collapsible className={rootClassName}>
      <RecoveryKeys panelProps={{ keepMounted: true }} />
    </Collapsible>
  ),
}

export const HiddenUntilFound: Story = {
  render: () => (
    <Collapsible className={rootClassName}>
      <RecoveryKeys panelProps={{ hiddenUntilFound: true }} />
    </Collapsible>
  ),
}

const settingSections = [
  {
    title: 'Model routing',
    description: 'Fallback model enabled, retry budget set to 2 attempts.',
    defaultOpen: true,
  },
  {
    title: 'Knowledge access',
    description: 'Retrieval is limited to approved workspace datasets.',
    defaultOpen: false,
  },
  {
    title: 'Observability',
    description: 'Request logs and workflow traces stay available for debugging.',
    defaultOpen: false,
  },
] as const

export const SettingsSections: Story = {
  parameters: {
    layout: 'padded',
  },
  render: () => (
    <div className={sectionRootClassName}>
      {settingSections.map((section, index) => (
        <Collapsible
          key={section.title}
          defaultOpen={section.defaultOpen}
          className={cn(index > 0 && 'mt-px')}
        >
          <CollapsibleTrigger className={sectionTriggerClassName}>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate system-sm-medium text-text-primary">{section.title}</span>
              <span className="line-clamp-2 system-xs-regular text-text-tertiary">{section.description}</span>
            </span>
            <TriggerIcon />
          </CollapsibleTrigger>
          <CollapsiblePanel className={sectionPanelClassName}>
            <div className="px-3 pt-1 pb-3 system-sm-regular text-text-secondary">
              {section.description}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ))}
    </div>
  ),
}
