import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { Switch, SwitchSkeleton } from '.'
import {
  FieldDescription,
  FieldLabel,
  FieldRoot,
} from '../field'

const meta = {
  title: 'Base/Form/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Toggle switch primitive with controlled and uncontrolled state support, loading state, and skeleton placeholder.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    checked: false,
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'Switch size',
    },
    checked: {
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

type SwitchDemoProps = Partial<Omit<React.ComponentProps<typeof Switch>, 'checked' | 'defaultChecked' | 'onCheckedChange'>> & {
  checked?: boolean
}

const SwitchDemo = (args: SwitchDemoProps) => {
  const [enabled, setEnabled] = React.useState(args.checked ?? false)

  return (
    <FieldRoot name="autoRetry" className="w-72">
      <FieldLabel className="flex items-center justify-between gap-3">
        <span>Enable auto retry</span>
        <Switch
          {...args}
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </FieldLabel>
      <FieldDescription>
        {enabled ? 'Failures will retry automatically.' : 'Failures require manual retry.'}
      </FieldDescription>
    </FieldRoot>
  )
}

export const Default: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: false,
    disabled: false,
  },
}

export const DefaultOn: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: true,
    disabled: false,
  },
}

export const DisabledOff: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: false,
    disabled: true,
  },
}

export const DisabledOn: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: true,
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
                  <Switch size={size} checked={false} onCheckedChange={() => {}} aria-label={`${size} unchecked switch`} />
                  <Switch size={size} checked={true} onCheckedChange={() => {}} aria-label={`${size} checked switch`} />
                </div>
              </td>
              <td className="py-3">
                <div className="flex gap-2">
                  <Switch size={size} checked={false} disabled aria-label={`${size} disabled unchecked switch`} />
                  <Switch size={size} checked={true} disabled aria-label={`${size} disabled checked switch`} />
                </div>
              </td>
              <td className="py-3">
                <div className="flex gap-2">
                  <Switch size={size} checked={false} loading aria-label={`${size} loading unchecked switch`} />
                  <Switch size={size} checked={true} loading aria-label={`${size} loading checked switch`} />
                </div>
              </td>
              <td className="py-3">
                <SwitchSkeleton size={size} aria-hidden="true" />
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
        story: 'Variant matrix for switch sizes and states.',
      },
    },
  },
}

const SizeComparisonDemo = () => {
  const [states, setStates] = React.useState({
    xs: false,
    sm: false,
    md: true,
    lg: true,
  })

  return (
    <div className="flex flex-col items-center space-y-4">
      <FieldRoot name="extraSmallSwitch">
        <FieldLabel className="flex items-center gap-3">
          <Switch size="xs" checked={states.xs} onCheckedChange={v => setStates({ ...states, xs: v })} />
          Extra Small (xs) - 14x10
        </FieldLabel>
      </FieldRoot>
      <FieldRoot name="smallSwitch">
        <FieldLabel className="flex items-center gap-3">
          <Switch size="sm" checked={states.sm} onCheckedChange={v => setStates({ ...states, sm: v })} />
          Small (sm) - 20x12
        </FieldLabel>
      </FieldRoot>
      <FieldRoot name="regularSwitch">
        <FieldLabel className="flex items-center gap-3">
          <Switch size="md" checked={states.md} onCheckedChange={v => setStates({ ...states, md: v })} />
          Regular (md) - 28x16
        </FieldLabel>
      </FieldRoot>
      <FieldRoot name="largeSwitch">
        <FieldLabel className="flex items-center gap-3">
          <Switch size="lg" checked={states.lg} onCheckedChange={v => setStates({ ...states, lg: v })} />
          Large (lg) - 36x20
        </FieldLabel>
      </FieldRoot>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => <SizeComparisonDemo />,
}

const LoadingDemo = () => {
  const [loading, setLoading] = React.useState(true)

  return (
    <div className="flex flex-col items-center space-y-4">
      <button
        className="rounded-sm border px-2 py-1 text-xs"
        onClick={() => setLoading(!loading)}
      >
        {loading ? 'Stop Loading' : 'Start Loading'}
      </button>
      <div className="space-y-3">
        <FieldRoot name="largeUncheckedLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="lg" checked={false} loading={loading} />
            Large unchecked
          </FieldLabel>
        </FieldRoot>
        <FieldRoot name="largeCheckedLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="lg" checked={true} loading={loading} />
            Large checked
          </FieldLabel>
        </FieldRoot>
        <FieldRoot name="regularUncheckedLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="md" checked={false} loading={loading} />
            Regular unchecked
          </FieldLabel>
        </FieldRoot>
        <FieldRoot name="regularCheckedLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="md" checked={true} loading={loading} />
            Regular checked
          </FieldLabel>
        </FieldRoot>
        <FieldRoot name="smallLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="sm" checked={false} loading={loading} />
            Small
          </FieldLabel>
        </FieldRoot>
        <FieldRoot name="extraSmallLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="xs" checked={false} loading={loading} />
            Extra Small
          </FieldLabel>
        </FieldRoot>
      </div>
    </div>
  )
}

export const Loading: Story = {
  render: () => <LoadingDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Loading state disables interaction and shows a spinner for md and lg sizes.',
      },
    },
  },
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function useMockAutoRetrySettingQuery() {
  const [enabled, setEnabled] = React.useState(false)

  return {
    data: {
      enabled,
    },
    setData: setEnabled,
  }
}

function useMockUpdateAutoRetrySettingMutation({
  onSuccess,
}: {
  onSuccess: (enabled: boolean) => void
}) {
  const [requestCount, setRequestCount] = React.useState(0)
  const [isPending, startTransition] = React.useTransition()

  const mutate = (nextValue: boolean) => {
    if (isPending)
      return

    startTransition(async () => {
      setRequestCount(current => current + 1)
      await wait(1200)
      onSuccess(nextValue)
    })
  }

  return {
    requestCount,
    isPending,
    mutate,
  }
}

const MutationLoadingDemo = () => {
  const autoRetrySetting = useMockAutoRetrySettingQuery()
  const updateAutoRetrySetting = useMockUpdateAutoRetrySettingMutation({
    onSuccess: autoRetrySetting.setData,
  })
  const statusText = updateAutoRetrySetting.isPending
    ? 'Saving changes...'
    : autoRetrySetting.data.enabled
      ? 'Auto retry is enabled.'
      : 'Auto retry is disabled.'

  return (
    <div className="grid w-90 gap-3 rounded-lg border border-components-panel-border bg-components-panel-bg p-4 shadow-sm">
      <FieldRoot name="autoRetry">
        <FieldLabel className="flex items-center justify-between gap-4">
          <span className="system-sm-medium text-text-secondary">Enable auto retry</span>
          <Switch
            size="lg"
            checked={autoRetrySetting.data.enabled}
            loading={updateAutoRetrySetting.isPending}
            onCheckedChange={updateAutoRetrySetting.mutate}
          />
        </FieldLabel>
        <FieldDescription>Retry failed workflow runs without manual intervention.</FieldDescription>
      </FieldRoot>

      <span className="text-xs text-text-tertiary" aria-live="polite">
        {statusText}
        {' '}
        Save attempts:
        {' '}
        {updateAutoRetrySetting.requestCount}
      </span>
    </div>
  )
}

export const MutationLoadingGuard: Story = {
  render: () => <MutationLoadingDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Controlled switch that enters loading while the change is saved.',
      },
    },
  },
}

const SkeletonDemo = () => (
  <div className="flex flex-col items-center space-y-4">
    <div className="flex items-center gap-3">
      <SwitchSkeleton size="xs" aria-hidden="true" />
      <span className="text-sm text-gray-700">Extra Small skeleton</span>
    </div>
    <div className="flex items-center gap-3">
      <SwitchSkeleton size="sm" aria-hidden="true" />
      <span className="text-sm text-gray-700">Small skeleton</span>
    </div>
    <div className="flex items-center gap-3">
      <SwitchSkeleton size="md" aria-hidden="true" />
      <span className="text-sm text-gray-700">Regular skeleton</span>
    </div>
    <div className="flex items-center gap-3">
      <SwitchSkeleton size="lg" aria-hidden="true" />
      <span className="text-sm text-gray-700">Large skeleton</span>
    </div>
  </div>
)

export const Skeleton: Story = {
  render: () => <SkeletonDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Non-interactive placeholders for switch loading layouts.',
      },
    },
  },
}

export const Playground: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: false,
    disabled: false,
    loading: false,
  },
}
