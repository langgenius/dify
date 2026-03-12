import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState, useTransition } from 'react'
import Switch from '.'
import { SwitchSkeleton } from './skeleton'

const meta = {
  title: 'Base/Data Entry/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Toggle switch built on Base UI with CVA variants, Figma-aligned design tokens, loading spinner, and skeleton placeholder. Import `Switch` for the toggle and `SwitchSkeleton` from `./skeleton` for loading placeholders.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    value: false,
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'Switch size',
    },
    value: {
      control: 'boolean',
      description: 'Checked state (controlled)',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    loading: {
      control: 'boolean',
      description: 'Loading state with spinner (md/lg only)',
    },
  },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

const SwitchDemo = (args: any) => {
  const [enabled, setEnabled] = useState(args.value ?? false)

  return (
    <div className="flex items-center justify-center gap-3">
      <Switch
        {...args}
        value={enabled}
        onChange={setEnabled}
      />
      <span className="text-sm text-gray-700">
        {enabled ? 'On' : 'Off'}
      </span>
    </div>
  )
}

export const Default: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    value: false,
    disabled: false,
  },
}

export const DefaultOn: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    value: true,
    disabled: false,
  },
}

export const DisabledOff: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    value: false,
    disabled: true,
  },
}

export const DisabledOn: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    value: true,
    disabled: true,
  },
}

const AllStatesDemo = () => {
  const sizes = ['xs', 'sm', 'md', 'lg'] as const

  return (
    <div style={{ width: '600px' }} className="space-y-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="pb-3 font-medium">Size</th>
            <th className="pb-3 font-medium">Default</th>
            <th className="pb-3 font-medium">Disabled</th>
            <th className="pb-3 font-medium">Loading</th>
            <th className="pb-3 font-medium">Skeleton</th>
          </tr>
        </thead>
        <tbody>
          {sizes.map(size => (
            <tr key={size} className="border-t border-gray-100">
              <td className="py-3 font-medium text-gray-900">{size}</td>
              <td className="py-3">
                <div className="flex gap-2">
                  <Switch size={size} value={false} onChange={() => {}} />
                  <Switch size={size} value={true} onChange={() => {}} />
                </div>
              </td>
              <td className="py-3">
                <div className="flex gap-2">
                  <Switch size={size} value={false} disabled />
                  <Switch size={size} value={true} disabled />
                </div>
              </td>
              <td className="py-3">
                <div className="flex gap-2">
                  <Switch size={size} value={false} loading />
                  <Switch size={size} value={true} loading />
                </div>
              </td>
              <td className="py-3">
                <SwitchSkeleton size={size} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const AllStates: Story = {
  render: () => <AllStatesDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Complete variant matrix: all sizes × all states, matching Figma design spec (node 2144:1210).',
      },
    },
  },
}

const SizeComparisonDemo = () => {
  const [states, setStates] = useState({
    xs: false,
    sm: false,
    md: true,
    lg: true,
  })

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="flex items-center gap-3">
        <Switch size="xs" value={states.xs} onChange={v => setStates({ ...states, xs: v })} />
        <span className="text-sm text-gray-700">Extra Small (xs) — 14×10</span>
      </div>
      <div className="flex items-center gap-3">
        <Switch size="sm" value={states.sm} onChange={v => setStates({ ...states, sm: v })} />
        <span className="text-sm text-gray-700">Small (sm) — 20×12</span>
      </div>
      <div className="flex items-center gap-3">
        <Switch size="md" value={states.md} onChange={v => setStates({ ...states, md: v })} />
        <span className="text-sm text-gray-700">Regular (md) — 28×16</span>
      </div>
      <div className="flex items-center gap-3">
        <Switch size="lg" value={states.lg} onChange={v => setStates({ ...states, lg: v })} />
        <span className="text-sm text-gray-700">Large (lg) — 36×20</span>
      </div>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => <SizeComparisonDemo />,
}

const LoadingDemo = () => {
  const [loading, setLoading] = useState(true)

  return (
    <div className="flex flex-col items-center space-y-4">
      <button
        className="rounded border px-2 py-1 text-xs"
        onClick={() => setLoading(!loading)}
      >
        {loading ? 'Stop Loading' : 'Start Loading'}
      </button>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch size="lg" value={false} loading={loading} />
          <span className="text-sm text-gray-700">Large unchecked</span>
        </div>
        <div className="flex items-center gap-3">
          <Switch size="lg" value={true} loading={loading} />
          <span className="text-sm text-gray-700">Large checked</span>
        </div>
        <div className="flex items-center gap-3">
          <Switch size="md" value={false} loading={loading} />
          <span className="text-sm text-gray-700">Regular unchecked</span>
        </div>
        <div className="flex items-center gap-3">
          <Switch size="md" value={true} loading={loading} />
          <span className="text-sm text-gray-700">Regular checked</span>
        </div>
        <div className="flex items-center gap-3">
          <Switch size="sm" value={false} loading={loading} />
          <span className="text-sm text-gray-700">Small (no spinner)</span>
        </div>
        <div className="flex items-center gap-3">
          <Switch size="xs" value={false} loading={loading} />
          <span className="text-sm text-gray-700">Extra Small (no spinner)</span>
        </div>
      </div>
    </div>
  )
}

export const Loading: Story = {
  render: () => <LoadingDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Loading state disables interaction and shows a spinning icon (i-ri-loader-2-line) for md/lg sizes. Spinner position mirrors the knob: appears on the opposite side of the checked state.',
      },
    },
  },
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const MutationLoadingDemo = () => {
  const [enabled, setEnabled] = useState(false)
  const [requestCount, setRequestCount] = useState(0)
  const [isPending, startTransition] = useTransition()

  const handleChange = (nextValue: boolean) => {
    if (isPending)
      return

    startTransition(async () => {
      setRequestCount(current => current + 1)
      await wait(1200)
      setEnabled(nextValue)
    })
  }

  return (
    <div className="w-[340px] space-y-4 rounded-2xl border border-components-panel-border bg-components-panel-bg p-4 shadow-sm">
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-primary">Mutation Loading Guard</p>
        <p className="text-xs text-text-tertiary">
          Click once to start a simulated mutate call. While the request is pending, the switch enters
          {' '}
          <code className="rounded bg-state-base-hover px-1 py-0.5 text-[11px]">loading</code>
          {' '}
          and rejects duplicate clicks.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-components-panel-border-subtle bg-background-default-dodge px-3 py-2 shadow-sm">
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">Enable Auto Retry</p>
          <p className="text-xs text-text-tertiary">
            {isPending ? 'Saving…' : enabled ? 'Saved as on' : 'Saved as off'}
          </p>
        </div>
        <Switch
          size="lg"
          value={enabled}
          loading={isPending}
          onChange={handleChange}
          aria-label="Enable Auto Retry"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-text-tertiary">
        <div className="rounded-lg bg-state-base-hover px-3 py-2">
          <div className="font-medium text-text-secondary">Committed Value</div>
          <div>{enabled ? 'On' : 'Off'}</div>
        </div>
        <div className="rounded-lg bg-state-base-hover px-3 py-2">
          <div className="font-medium text-text-secondary">Mutate Count</div>
          <div>{requestCount}</div>
        </div>
      </div>
    </div>
  )
}

export const MutationLoadingGuard: Story = {
  render: () => <MutationLoadingDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Simulates a controlled switch backed by an async mutate call. The component keeps its previous committed value, sets `loading` during the request, and blocks duplicate clicks until the mutation resolves.',
      },
    },
  },
}

const SkeletonDemo = () => (
  <div className="flex flex-col items-center space-y-4">
    <div className="flex items-center gap-3">
      <SwitchSkeleton size="xs" />
      <span className="text-sm text-gray-700">Extra Small skeleton</span>
    </div>
    <div className="flex items-center gap-3">
      <SwitchSkeleton size="sm" />
      <span className="text-sm text-gray-700">Small skeleton</span>
    </div>
    <div className="flex items-center gap-3">
      <SwitchSkeleton size="md" />
      <span className="text-sm text-gray-700">Regular skeleton</span>
    </div>
    <div className="flex items-center gap-3">
      <SwitchSkeleton size="lg" />
      <span className="text-sm text-gray-700">Large skeleton</span>
    </div>
  </div>
)

export const Skeleton: Story = {
  render: () => <SkeletonDemo />,
  parameters: {
    docs: {
      description: {
        story: '`SwitchSkeleton` renders a non-interactive placeholder with `bg-text-quaternary opacity-20`. Imported separately from `./skeleton`.',
      },
    },
  },
}

export const Playground: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    value: false,
    disabled: false,
    loading: false,
  },
}
