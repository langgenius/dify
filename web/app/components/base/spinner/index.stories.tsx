import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import Spinner from '.'

const SpinnerPlayground = ({
  loading = true,
}: {
  loading?: boolean
}) => {
  const [isLoading, setIsLoading] = useState(loading)

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl border border-divider-subtle bg-components-panel-bg p-6">
      <p className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Spinner</p>
      <Spinner loading={isLoading} className="text-primary-500" />
      <button
        type="button"
        className="rounded-md border border-divider-subtle bg-background-default px-3 py-1 text-xs font-medium text-text-secondary hover:bg-state-base-hover"
        onClick={() => setIsLoading(prev => !prev)}
      >
        {isLoading ? 'Stop' : 'Start'} loading
      </button>
    </div>
  )
}

const meta = {
  title: 'Base/Feedback/Spinner',
  component: SpinnerPlayground,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Minimal spinner powered by Tailwind utilities. Toggle the state to inspect motion-reduced behaviour.',
      },
    },
  },
  argTypes: {
    loading: { control: 'boolean' },
  },
  args: {
    loading: true,
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SpinnerPlayground>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}
