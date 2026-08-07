import type { ModelProviderCreditsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import CreditsExhaustedAlert from './credits-exhausted-alert'

const baseCredits: ModelProviderCreditsResponse = {
  pool_type: 'trial',
  quota_limit: 200,
  quota_used: 200,
  remaining_credits: 0,
  is_unlimited: false,
  is_exhausted: true,
  exhausted_at: 0,
  next_credit_reset_date: Date.now() + 86400000,
}

function createSeededQueryClient(overrides?: Partial<ModelProviderCreditsResponse>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  })
  qc.setQueryData(consoleQuery.workspaces.current.modelProviders.credits.get.queryKey(), {
    ...baseCredits,
    ...overrides,
  })
  return qc
}

const meta = {
  title: 'ModelProvider/CreditsExhaustedAlert',
  component: CreditsExhaustedAlert,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Alert shown when trial credits are exhausted, with usage progress bar and upgrade link.',
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
        <QueryClientProvider
          client={createSeededQueryClient({
            quota_limit: 500,
            quota_used: 480,
            remaining_credits: 20,
            is_exhausted: false,
          })}
        >
          <div className="w-[320px]">
            <Story />
          </div>
        </QueryClientProvider>
      )
    },
  ],
}
