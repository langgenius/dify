import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ICurrentWorkspace } from '@/models/common'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CreditsExhaustedAlert from './credits-exhausted-alert'

const baseWorkspace: ICurrentWorkspace = {
  id: 'ws-1',
  name: 'Test Workspace',
  plan: 'sandbox',
  status: 'normal',
  created_at: Date.now(),
  role: 'owner',
  providers: [],
  trial_credits: 200,
  trial_credits_used: 200,
  next_credit_reset_date: Date.now() + 86400000,
}

function createSeededQueryClient(overrides?: Partial<ICurrentWorkspace>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  })
  qc.setQueryData(['common', 'current-workspace'], { ...baseWorkspace, ...overrides })
  return qc
}

const meta = {
  title: 'ModelProvider/CreditsExhaustedAlert',
  component: CreditsExhaustedAlert,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Alert shown when trial credits are exhausted, with usage progress bar and upgrade link.',
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => {
      return (
        <QueryClientProvider client={createSeededQueryClient()}>
          <div className="w-[320px]">
            <Story />
          </div>
        </QueryClientProvider>
      )
    },
  ],
  args: {
    hasApiKeyFallback: false,
  },
} satisfies Meta<typeof CreditsExhaustedAlert>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithApiKeyFallback: Story = {
  args: {
    hasApiKeyFallback: true,
  },
}

export const PartialUsage: Story = {
  decorators: [
    (Story) => {
      return (
        <QueryClientProvider client={createSeededQueryClient({ trial_credits: 500, trial_credits_used: 480 })}>
          <div className="w-[320px]">
            <Story />
          </div>
        </QueryClientProvider>
      )
    },
  ],
}
