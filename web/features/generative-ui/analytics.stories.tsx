import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { AnalyticsDemoCase } from './demo-cases'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import appDebug from '@/i18n/locales/en-US/app-debug.json'
import { ANALYTICS_DEMO_CASES } from './demo-cases'
import { GENERATIVE_UI_LIBRARY_VERSION } from './registry/definitions'
import { GenerativeUIRenderer } from './renderer'

const meta = {
  title: 'Features/Generative UI/Analytics',
  component: GenerativeUIRenderer,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <I18nClientProvider locale="en-US" resource={{ 'en-US': { appDebug } }}>
        <div className="mx-auto w-full max-w-180 bg-background-default p-4">
          <Story />
        </div>
      </I18nClientProvider>
    ),
  ],
  args: {
    libraryVersion: GENERATIVE_UI_LIBRARY_VERSION,
    isStreaming: false,
  },
} satisfies Meta<typeof GenerativeUIRenderer>

export default meta
type Story = StoryObj<typeof meta>

function demoStory(demo: AnalyticsDemoCase): Story {
  return {
    args: { source: demo.source, fallbackText: demo.fallbackText },
    parameters: { docs: { description: { story: demo.prompt } } },
  }
}

export const Trend: Story = demoStory(ANALYTICS_DEMO_CASES[0])
export const Comparison: Story = demoStory(ANALYTICS_DEMO_CASES[1])
export const Metrics: Story = demoStory(ANALYTICS_DEMO_CASES[2])
export const Dashboard: Story = demoStory(ANALYTICS_DEMO_CASES[3])

export const NarrowDashboard: Story = {
  ...Dashboard,
  decorators: [
    (Story) => (
      <div className="w-full max-w-80">
        <Story />
      </div>
    ),
  ],
}
