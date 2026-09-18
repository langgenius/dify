import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CollapsiblePanelProps } from '.'
import { useState } from 'react'
import { expect, waitFor } from 'storybook/test'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '.'
import { Button } from '../button'
import { cn } from '../cn'
import { IconButton } from '../icon-button'

const meta = {
  title: 'Base/UI/Collapsible',
  component: Collapsible,
  decorators: [
    (Story, { parameters }) => (
      <div className="p-4" style={{ height: parameters.docs.story.height }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'centered',
    docs: {
      story: { height: '240px' },
      description: {
        component:
          'Trigger exposes Base UI disclosure behavior without styles. Compose Button or IconButton with render, or style the native button and its focus indicator. Root and Panel provide Dify layout and motion defaults.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

const rootClassName =
  'w-72 rounded-lg border border-components-panel-border bg-components-panel-bg p-1'
const triggerClassName =
  'group/collapsible flex min-h-8 w-full items-center rounded-lg px-2.5 text-start system-sm-medium text-text-secondary outline-hidden hover:not-data-disabled:bg-components-panel-on-panel-item-bg-hover hover:not-data-disabled:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid data-panel-open:text-text-primary data-disabled:cursor-not-allowed data-disabled:text-text-disabled'
const panelClassName = 'system-sm-regular text-text-secondary'

function TriggerIcon() {
  return (
    <span
      aria-hidden
      className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary transition-transform duration-100 ease-out group-data-panel-open/collapsible:rotate-90 motion-reduce:transition-none"
    />
  )
}

function RecoveryKeys(props: Pick<CollapsiblePanelProps, 'keepMounted' | 'hiddenUntilFound'>) {
  return (
    <>
      <CollapsibleTrigger className={cn(triggerClassName, 'justify-between gap-2')}>
        Recovery keys
        <TriggerIcon />
      </CollapsibleTrigger>
      <CollapsiblePanel className={panelClassName} {...props}>
        <div className="flex flex-col gap-2 px-2.5 pt-1 pb-2">
          <div>alien-bean-pasta</div>
          <div>wild-irish-burrito</div>
          <div>horse-battery-staple</div>
        </div>
      </CollapsiblePanel>
    </>
  )
}

export const Anatomy: Story = {
  args: { defaultOpen: true },
  render: (args) => (
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
  play: async ({ canvas, canvasElement, userEvent }) => {
    const canvasHeight = canvasElement.getBoundingClientRect().height
    const trigger = canvas.getByRole('button', { name: 'Recovery keys' })
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('alien-bean-pasta')).toBeVisible()
    await expect(canvasElement.getBoundingClientRect().height).toBe(canvasHeight)
    await userEvent.keyboard(' ')
    await waitFor(() => expect(canvas.queryByText('alien-bean-pasta')).not.toBeInTheDocument())
    await expect(trigger).toHaveFocus()
    await expect(canvasElement.getBoundingClientRect().height).toBe(canvasHeight)
  },
}

export const ButtonTrigger: Story = {
  render: () => (
    <Collapsible className="w-72 items-start gap-2">
      <CollapsibleTrigger render={<Button variant="secondary" />}>
        Advanced options
      </CollapsibleTrigger>
      <CollapsiblePanel className={panelClassName}>
        <p>Configure retry limits and response timeouts.</p>
      </CollapsiblePanel>
    </Collapsible>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Advanced options' })
    await userEvent.click(trigger)
    await expect(canvas.getByText('Configure retry limits and response timeouts.')).toBeVisible()
    await userEvent.click(trigger)
    await waitFor(() =>
      expect(
        canvas.queryByText('Configure retry limits and response timeouts.'),
      ).not.toBeInTheDocument(),
    )
  },
}

export const IconButtonTrigger: Story = {
  render: () => (
    <Collapsible className="w-72 gap-2">
      <div className="flex items-center justify-between">
        <span className="system-sm-medium text-text-secondary">Build details</span>
        <CollapsibleTrigger
          render={
            <IconButton aria-label="Build details">
              <span aria-hidden className="i-ri-information-2-line size-4" />
            </IconButton>
          }
        />
      </div>
      <CollapsiblePanel className={panelClassName}>
        <p>The draft contains two changes ready to review.</p>
      </CollapsiblePanel>
    </Collapsible>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Build details' })
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByText('The draft contains two changes ready to review.')).toBeVisible()
    await userEvent.keyboard(' ')
    await waitFor(() =>
      expect(
        canvas.queryByText('The draft contains two changes ready to review.'),
      ).not.toBeInTheDocument(),
    )
    await expect(trigger).toHaveFocus()
  },
}

function ControlledDemo() {
  const [open, setOpen] = useState(true)
  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Reset disclosure
      </Button>
      <Collapsible open={open} onOpenChange={setOpen} className={rootClassName}>
        <RecoveryKeys />
      </Collapsible>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Recovery keys' }))
    await waitFor(() => expect(canvas.queryByText('alien-bean-pasta')).not.toBeInTheDocument())
    await userEvent.click(canvas.getByRole('button', { name: 'Reset disclosure' }))
    await expect(canvas.getByText('alien-bean-pasta')).toBeVisible()
  },
}

export const Disabled: Story = {
  render: () => (
    <Collapsible disabled className="w-72 items-start">
      <CollapsibleTrigger render={<Button variant="secondary" />}>
        Unavailable options
      </CollapsibleTrigger>
      <CollapsiblePanel>These options are not available.</CollapsiblePanel>
    </Collapsible>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Unavailable options' })
    await expect(trigger).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByText('These options are not available.')).not.toBeInTheDocument()
  },
}

export const KeepMounted: Story = {
  render: () => (
    <Collapsible className={rootClassName}>
      <RecoveryKeys keepMounted />
    </Collapsible>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('alien-bean-pasta')).not.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Recovery keys' }))
    await expect(canvas.getByText('alien-bean-pasta')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Recovery keys' }))
    await waitFor(() => expect(canvas.getByText('alien-bean-pasta')).not.toBeVisible())
  },
}

export const HiddenUntilFound: Story = {
  render: () => (
    <Collapsible className={rootClassName}>
      <RecoveryKeys hiddenUntilFound />
    </Collapsible>
  ),
}

const settingSections = [
  {
    title: 'Model routing',
    description: 'Fallback model enabled, retry budget set to 2 attempts.',
  },
  {
    title: 'Knowledge access',
    description: 'Retrieval is limited to approved workspace datasets.',
  },
  {
    title: 'Observability',
    description: 'Request logs and workflow traces stay available for debugging.',
  },
]

export const IndependentSections: Story = {
  parameters: {
    docs: { story: { height: '400px' } },
  },
  render: () => (
    <div className="w-90 space-y-2">
      {settingSections.map((section) => (
        <Collapsible key={section.title} className="rounded-lg border border-divider-subtle p-2">
          <h3>
            <CollapsibleTrigger className={cn(triggerClassName, 'justify-start gap-1')}>
              <TriggerIcon />
              {section.title}
            </CollapsibleTrigger>
          </h3>
          <CollapsiblePanel className={panelClassName}>
            <p className="px-2.5 py-2">{section.description}</p>
          </CollapsiblePanel>
        </Collapsible>
      ))}
    </div>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const canvasHeight = canvasElement.getBoundingClientRect().height
    for (const { title } of settingSections)
      await userEvent.click(canvas.getByRole('button', { name: title }))
    for (const { description } of settingSections)
      await expect(canvas.getByText(description)).toBeVisible()
    await expect(canvasElement.getBoundingClientRect().height).toBe(canvasHeight)
  },
}
