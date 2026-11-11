import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { userEvent, within } from 'storybook/test'
import { ExternalAgentTestPanel } from '.'
import { createExternalRosterPreview } from '../../../roster/external-roster-preview'
import { createExternalAgentOverviewPreview } from '../../preview'

const preview = createExternalAgentOverviewPreview(createExternalRosterPreview()[1]!)

async function startTest(canvasElement: HTMLElement) {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Test agent' }))
  const body = within(canvasElement.ownerDocument.body)
  const panel = within(await body.findByRole('dialog', { name: 'Test agent' }))
  await userEvent.click(await panel.findByRole('button', { name: 'Contract review' }))
  await userEvent.click(panel.getByRole('button', { name: 'Run test' }))
  return panel
}

const meta = {
  title: 'Agents/External Agents/Test run',
  component: ExternalAgentTestPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="isolate min-h-screen bg-background-default p-8">
        <Story />
      </div>
    ),
  ],
  args: {
    skills: preview.skills,
    sampleResponse: preview.sampleResponse,
    sampleTraceSteps: preview.sampleTraceSteps,
    tracing: true,
  },
} satisfies Meta<typeof ExternalAgentTestPanel>

export default meta
type Story = StoryObj<typeof meta>

export const SuccessNotification: Story = {
  play: async ({ canvasElement }) => {
    const panel = await startTest(canvasElement)
    await userEvent.click(panel.getByRole('button', { name: 'Close' }))
  },
}

export const FailureNotification: Story = {
  args: { sampleOutcome: 'failed' },
  play: SuccessNotification.play,
}

export const Stopping: Story = {
  play: async ({ canvasElement }) => {
    const panel = await startTest(canvasElement)
    await panel.findByText('1 step received', {}, { timeout: 2_000 })
    await userEvent.click(panel.getByRole('button', { name: 'Stop test' }))
  },
}
