import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Infotip, InfotipContent, InfotipTitle, InfotipTrigger } from '.'
import { Button } from '../button'

const meta = {
  title: 'Base/UI/Infotip',
  component: Infotip,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An information button whose primary action is opening an explanation. Unlike Tooltip, it uses Popover semantics and supports click, touch, keyboard, and links. Name the trigger and dialog with a short topic, preferably referencing an existing visible label. Keep the explanation in the body; do not copy it into aria-label.',
      },
    },
  },
} satisfies Meta<typeof Infotip>

export default meta
type Story = StoryObj<typeof meta>

function ProcessingHint() {
  const labelId = React.useId()
  return (
    <div className="flex items-center gap-1 text-text-secondary">
      <span id={labelId}>Document processing</span>
      <Infotip>
        <InfotipTrigger aria-labelledby={labelId} />
        <InfotipContent aria-labelledby={labelId}>
          Documents are processed in the order they are received. Larger files can take longer to
          finish indexing.
        </InfotipContent>
      </Infotip>
    </div>
  )
}

export const Default: Story = {
  render: () => <ProcessingHint />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'Document processing' })
    await userEvent.hover(trigger)
    const popup = await body.findByRole('dialog', { name: 'Document processing' })
    await userEvent.hover(popup)
    await waitFor(() => expect(popup).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

export const WithLink: Story = {
  render: () => (
    <Infotip>
      <InfotipTrigger aria-label="Agent instructions" iconVariant="information" />
      <InfotipContent aria-label="Agent instructions" className="w-60">
        Describe the agent’s task and the rules it should follow.{' '}
        <a href="https://docs.dify.ai" className="text-text-accent underline">
          Read the documentation
        </a>
      </InfotipContent>
    </Infotip>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole('button', { name: 'Agent instructions' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const popup = await body.findByRole('dialog', { name: 'Agent instructions' })
    await waitFor(() =>
      expect(within(popup).getByRole('link', { name: 'Read the documentation' })).toHaveFocus(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  },
}

function HeadingHint() {
  return (
    <Infotip defaultOpen>
      <InfotipTrigger aria-label="Processing priority" />
      <InfotipContent>
        <InfotipTitle>Processing priority</InfotipTitle>
        <p>Priority determines which documents are processed first.</p>
      </InfotipContent>
    </Infotip>
  )
}

export const WithHeading: Story = {
  render: () => <HeadingHint />,
}

function ControlledExample() {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="flex items-center gap-3">
      <Button onClick={() => setOpen(true)}>Show explanation</Button>
      <Infotip open={open} onOpenChange={setOpen}>
        <InfotipTrigger aria-label="Processing error" iconVariant="warning" />
        <InfotipContent aria-label="Processing error">
          The file could not be processed. Review its contents before trying again.
        </InfotipContent>
      </Infotip>
    </div>
  )
}

export const Controlled: Story = {
  render: () => <ControlledExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Show explanation' }))
    await waitFor(() =>
      expect(body.getByRole('dialog', { name: 'Processing error' })).toBeVisible(),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

export const LongText: Story = {
  render: () => (
    <Infotip>
      <InfotipTrigger aria-label="Indexing error" iconVariant="warning" />
      <InfotipContent aria-label="Indexing error" className="w-60 whitespace-pre-wrap">
        {
          'Unable to index the document.\nSource: https://example.com/documents/0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz'
        }
      </InfotipContent>
    </Infotip>
  ),
}
