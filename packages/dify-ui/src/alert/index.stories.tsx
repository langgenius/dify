import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect, within } from 'storybook/test'
import { Alert, AlertActions, AlertClose, AlertDescription, AlertTitle } from '.'
import { Button } from '../button'

const meta = {
  title: 'Base/UI/Alert',
  component: Alert,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'An in-page status message aligned with the Dify Design Kit Alert. `type` sets the status icon, the background halo, and the default role: `alert` for errors and `status` otherwise; pass `role` when an error is already present on page load and should not interrupt. `AlertTitle` is always present; add `AlertDescription` for detail and `AlertActions` for buttons below the text. `AlertClose` is a stateless close button with a required `aria-label`; the caller decides whether the alert stays hidden. The icon cannot be replaced, so a banner that needs a product or business icon is not an Alert.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    type: 'info',
  },
  argTypes: {
    type: {
      control: 'select',
      options: ['info', 'success', 'warning', 'error'],
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>Web app settings apply to all environments.</AlertTitle>
    </Alert>
  ),
}

export const Types: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Alert type="info">
        <AlertTitle>Some logs in this time range may have been archived.</AlertTitle>
      </Alert>
      <Alert type="success">
        <AlertTitle>The connection is ready.</AlertTitle>
      </Alert>
      <Alert type="warning">
        <AlertTitle>This connection was updated by someone else.</AlertTitle>
      </Alert>
      <Alert type="error">
        <AlertTitle>Could not save the connection.</AlertTitle>
      </Alert>
    </div>
  ),
}

export const WithDescription: Story = {
  render: () => (
    <Alert type="warning">
      <AlertTitle>This connection was updated by someone else.</AlertTitle>
      <AlertDescription>Review the latest configuration before saving.</AlertDescription>
    </Alert>
  ),
}

export const WithActions: Story = {
  render: () => (
    <Alert type="warning">
      <AlertTitle>Current draft will be overwritten.</AlertTitle>
      <AlertDescription>Export the workflow as a backup before importing.</AlertDescription>
      <AlertActions>
        <Button size="small" variant="primary">
          Backup current draft
        </Button>
        <Button size="small">Import anyway</Button>
      </AlertActions>
    </Alert>
  ),
}

function DismissibleAlert() {
  const [visible, setVisible] = React.useState(true)

  if (!visible) return <Button onClick={() => setVisible(true)}>Show again</Button>

  return (
    <Alert type="info">
      <AlertTitle>
        This is a sample app with limited trial messages. To keep using it, create your own copy.
      </AlertTitle>
      <AlertClose aria-label="Dismiss" onClick={() => setVisible(false)} />
    </Alert>
  )
}

export const Dismissible: Story = {
  render: () => <DismissibleAlert />,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }))
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument()
  },
}
