import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useEffect, useState } from 'react'
import TabSlider from '.'

const OPTIONS = [
  { value: 'models', text: 'Models' },
  { value: 'datasets', text: 'Datasets' },
  { value: 'plugins', text: 'Plugins' },
]

const TabSliderDemo = ({
  initialValue = 'models',
}: {
  initialValue?: string
}) => {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    const originalFetch = globalThis.fetch?.bind(globalThis)

    const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url.includes('/workspaces/current/plugin/list')) {
        return new Response(
          JSON.stringify({
            total: 6,
            plugins: [],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (originalFetch)
        return originalFetch(input, init)

      throw new Error(`Unhandled request for ${url}`)
    }

    globalThis.fetch = handler as typeof globalThis.fetch

    return () => {
      if (originalFetch)
        globalThis.fetch = originalFetch
    }
  }, [])

  return (
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Segmented tabs</div>
      <TabSlider
        value={value}
        options={OPTIONS}
        onChange={setValue}
      />
    </div>
  )
}

const meta = {
  title: 'Base/Navigation/TabSlider',
  component: TabSliderDemo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Animated segmented control with sliding highlight. A badge appears when plugins are installed (mocked in Storybook).',
      },
    },
  },
  argTypes: {
    initialValue: {
      control: 'radio',
      options: OPTIONS.map(option => option.value),
    },
  },
  args: {
    initialValue: 'models',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TabSliderDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
