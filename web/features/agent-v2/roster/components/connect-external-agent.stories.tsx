import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type {
  ExternalConnectionFailureReason,
  ExternalConnectionVerificationResult,
  VerifyExternalConnection,
} from './external-connection-verification'
import { fn, userEvent, within } from 'storybook/test'
import { externalConnectionPreview } from '../external-roster-preview'
import { ConnectExternalAgent } from './connect-external-agent'

const previewEndpoint = 'https://agents.acme.example/contract-review'

function failedVerification(reason: ExternalConnectionFailureReason): VerifyExternalConnection {
  return () => Promise.resolve({ status: 'failed', reason })
}

async function submitConnection(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(await canvas.findByRole('button', { name: 'Connect external agent' }))

  // Dialogs and Select options are portalled outside the Storybook canvas.
  const body = within(canvasElement.ownerDocument.body)
  const dialog = await body.findByRole('dialog', { name: 'Connect external agent' })
  const fields = within(dialog)
  await userEvent.type(fields.getByRole('textbox', { name: 'A2A endpoint' }), previewEndpoint)
  await userEvent.click(fields.getByRole('combobox', { name: 'Authentication' }))
  await userEvent.click(await body.findByRole('option', { name: 'Bearer token' }))
  await userEvent.type(fields.getByLabelText('Token'), 'preview-only-token')
  await userEvent.click(fields.getByRole('button', { name: 'Verify connection' }))
  return fields
}

const meta = {
  title: 'Agents/External Agents/Connect',
  component: ConnectExternalAgent,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="isolate min-h-screen bg-background-default p-8">
        <Story />
      </div>
    ),
  ],
  args: { onConnect: fn() },
  play: async ({ canvasElement }) => {
    const fields = await submitConnection(canvasElement)
    await fields.findByRole('alert')
  },
} satisfies Meta<typeof ConnectExternalAgent>

export default meta
type Story = StoryObj<typeof meta>

export const Unreachable: Story = {
  args: { verifyConnection: failedVerification('unreachable') },
}

export const AuthenticationFailed: Story = {
  args: { verifyConnection: failedVerification('authentication') },
}

export const UnsupportedEndpoint: Story = {
  args: { verifyConnection: failedVerification('unsupported') },
}

export const InvalidAgentCard: Story = {
  args: { verifyConnection: failedVerification('invalid-agent-card') },
}

export const UnknownFailure: Story = {
  args: { verifyConnection: failedVerification('unknown') },
}

export const Verifying: Story = {
  args: {
    verifyConnection: () => new Promise<ExternalConnectionVerificationResult>(() => {}),
  },
  play: async ({ canvasElement }) => {
    const fields = await submitConnection(canvasElement)
    await fields.findByRole('button', { name: 'Verifying…' })
  },
}

export const VerifiedAfterBack: Story = {
  args: {
    verifyConnection: () =>
      Promise.resolve({ status: 'verified', agent: externalConnectionPreview }),
  },
  play: async ({ canvasElement }) => {
    const fields = await submitConnection(canvasElement)
    await userEvent.click(await fields.findByRole('button', { name: 'Back' }))
    await fields.findByRole('button', { name: 'Continue' })
  },
}
