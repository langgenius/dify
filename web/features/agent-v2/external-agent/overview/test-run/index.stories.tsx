import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { TestAgentRun } from './use-test-run'
import { fn } from 'storybook/test'
import { TestAgentResults } from './results'

const result: TestAgentRun = {
  status: 'succeeded',
  elapsedSeconds: 4.2,
  tracing: false,
  currentInvocationId: undefined,
  result: {
    invocation_id: '88888888-8888-4888-8888-888888888888',
    state: 'succeeded',
    outputs: { text: 'The contract requires review of the payment deadline.' },
    error_code: null,
    error_message: null,
    metadata: {},
  },
}
const meta = {
  title: 'Agents/External Agents/Test run results',
  component: TestAgentResults,
  args: { run: result, tab: 'result', onTabChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-100 max-w-full bg-components-panel-bg p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TestAgentResults>
export default meta
type Story = StoryObj<typeof meta>
export const Succeeded: Story = {}
export const Failed: Story = {
  args: {
    run: {
      ...result,
      status: 'failed',
      result: {
        ...result.result!,
        state: 'failed',
        outputs: null,
        error_code: 'output_validation_error',
        error_message: 'The agent returned an unsupported output format.',
      },
    },
  },
}
export const Stopped: Story = {
  args: {
    run: {
      ...result,
      status: 'stopped',
      elapsedSeconds: null,
      result: {
        ...result.result!,
        state: 'stopped',
        outputs: null,
        metadata: { cancellation_state: 'confirmed' },
      },
    },
  },
}
