import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Infotip, InfotipContent, InfotipTrigger } from '.'
import { Button } from '../button'

const meta = {
  title: 'Base/UI/Infotip',
  component: Infotip,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An information button that opens explanatory content using Popover semantics. Compose the root, icon trigger, and content. Name the trigger and the dialog; use aria-labelledby when a visible heading exists. The popup remains available to keyboard and touch users and may contain links.',
      },
    },
  },
} satisfies Meta<typeof Infotip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-1 text-text-secondary">
      Document processing
      <Infotip>
        <InfotipTrigger aria-label="Document processing" />
        <InfotipContent aria-label="Document processing">
          Documents are processed in the order they are received. Larger files can take longer to
          finish indexing.
        </InfotipContent>
      </Infotip>
    </div>
  ),
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
