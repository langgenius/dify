import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ExternalConnectionVerificationState } from './external-connection-verification'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { createRef } from 'react'
import { fn } from 'storybook/test'
import { createExternalVerification } from '../__tests__/external-connection-fixture'
import { ExternalConnectionForm } from './external-connection-form'

const meta = {
  title: 'Agents/External Agents/Connect',
  component: ExternalConnectionForm,
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <Dialog open>
      <DialogContent className="w-150">
        <DialogHeader>
          <DialogTitle>Connect external agent</DialogTitle>
          <DialogDescription>Connect an existing agent to use in your apps.</DialogDescription>
        </DialogHeader>
        <ExternalConnectionForm {...args} />
      </DialogContent>
    </Dialog>
  ),
  args: {
    initialSettings: {
      endpoint: 'https://agents.example.test/contract',
      authentication: 'none',
      token: '',
    },
    verification: { status: 'unverified' } satisfies ExternalConnectionVerificationState,
    endpointRef: createRef<HTMLInputElement>(),
    executionEnabled: true,
    onVerify: fn(),
    onContinue: fn(),
    onInvalidate: fn(),
  },
} satisfies Meta<typeof ExternalConnectionForm>

export default meta
type Story = StoryObj<typeof meta>

export const Connection: Story = {}
export const Verifying: Story = { args: { verification: { status: 'verifying' } } }
export const VerificationFailed: Story = {
  args: {
    verification: {
      status: 'failed',
      message: 'Could not verify this connection. Check the endpoint and authentication.',
    },
  },
}
export const VerificationExpired: Story = { args: { verification: { status: 'expired' } } }
export const ExecutionDisabled: Story = { args: { executionEnabled: false } }
export const AuthenticationNotExercised: Story = {
  args: { verification: { status: 'verified', evidence: createExternalVerification() } },
}
export const AuthenticationPassedForReadEndpoint: Story = {
  args: {
    verification: {
      status: 'verified',
      evidence: createExternalVerification({ auth_check: 'passed_for_read_endpoint' }),
    },
  },
}
