import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { expect } from 'storybook/test'
import { Switch, SwitchSkeleton } from '.'
import { DirectionProvider } from '../direction-provider'
import { Field, FieldDescription, FieldLabel } from '../field'

const meta = {
  title: 'Base/Form/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Toggle switch primitive with controlled and uncontrolled state support, loading state, and skeleton placeholder. Label it with a visible `FieldLabel` or `<label>`; use `aria-label` only when there is no visible label, because a non-blank `aria-label` takes precedence over any associated label.',
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

type SwitchDemoProps = Partial<
  Omit<React.ComponentProps<typeof Switch>, 'checked' | 'defaultChecked' | 'onCheckedChange'>
> & {
  checked?: boolean
}

function SwitchDemo(args: SwitchDemoProps) {
  const [enabled, setEnabled] = React.useState(args.checked ?? false)

  return (
    <Field name="autoRetry" className="w-72">
      <FieldLabel className="flex items-center justify-between gap-3">
        <span>Enable auto retry</span>
        <Switch {...args} checked={enabled} onCheckedChange={setEnabled} />
      </FieldLabel>
      <FieldDescription>
        {enabled ? 'Failures will retry automatically.' : 'Failures require manual retry.'}
      </FieldDescription>
    </Field>
  )
}

export const Default: Story = {
  render: (args) => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: false,
    disabled: false,
  },
  play: async ({ canvas, userEvent }) => {
    const switchControl = canvas.getByRole('switch', { name: 'Enable auto retry' })

    await expect(switchControl).toHaveAttribute('aria-checked', 'false')
    await expect(canvas.getByText('Failures require manual retry.')).toBeVisible()

    await userEvent.click(switchControl)

    await expect(switchControl).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByText('Failures will retry automatically.')).toBeVisible()
  },
}

export const DefaultOn: Story = {
  render: (args) => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: true,
    disabled: false,
  },
}

export const DisabledOff: Story = {
  render: (args) => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: false,
    disabled: true,
  },
}

export const DisabledOn: Story = {
  render: (args) => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: true,
    disabled: true,
  },
}

function AllStatesDemo() {
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
          {sizes.map((size) => (
            <tr key={size} className="border-t border-gray-100">
              <td className="py-3 font-medium text-gray-900">{size}</td>
              <td className="py-3">
                <div className="flex gap-2">
                  <Switch
                    size={size}
                    checked={false}
                    onCheckedChange={() => {}}
                    aria-label={`${size} unchecked switch`}
                  />
                  <Switch
                    size={size}
                    checked={true}
                    onCheckedChange={() => {}}
                    aria-label={`${size} checked switch`}
                  />
                </div>
              </td>
              <td className="py-3">
                <div className="flex gap-2">
                  <Switch
                    size={size}
                    checked={false}
                    disabled
                    aria-label={`${size} disabled unchecked switch`}
                  />
                  <Switch
                    size={size}
                    checked={true}
                    disabled
                    aria-label={`${size} disabled checked switch`}
                  />
                </div>
              </td>
              <td className="py-3">
                <div className="flex gap-2">
                  <Switch
                    size={size}
                    checked={false}
                    loading
                    aria-label={`${size} loading unchecked switch`}
                  />
                  <Switch
                    size={size}
                    checked={true}
                    loading
                    aria-label={`${size} loading checked switch`}
                  />
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

function SizeComparisonDemo() {
  const [states, setStates] = React.useState({
    xs: false,
    sm: false,
    md: true,
    lg: true,
  })

  return (
    <div className="flex flex-col items-center space-y-4">
      <Field name="extraSmallSwitch">
        <FieldLabel className="flex items-center gap-3">
          <Switch
            size="xs"
            checked={states.xs}
            onCheckedChange={(v) => setStates({ ...states, xs: v })}
          />
          Extra Small (xs) - 14x10
        </FieldLabel>
      </Field>
      <Field name="smallSwitch">
        <FieldLabel className="flex items-center gap-3">
          <Switch
            size="sm"
            checked={states.sm}
            onCheckedChange={(v) => setStates({ ...states, sm: v })}
          />
          Small (sm) - 20x12
        </FieldLabel>
      </Field>
      <Field name="regularSwitch">
        <FieldLabel className="flex items-center gap-3">
          <Switch
            size="md"
            checked={states.md}
            onCheckedChange={(v) => setStates({ ...states, md: v })}
          />
          Regular (md) - 28x16
        </FieldLabel>
      </Field>
      <Field name="largeSwitch">
        <FieldLabel className="flex items-center gap-3">
          <Switch
            size="lg"
            checked={states.lg}
            onCheckedChange={(v) => setStates({ ...states, lg: v })}
          />
          Large (lg) - 36x20
        </FieldLabel>
      </Field>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => <SizeComparisonDemo />,
}

function RTLDemo() {
  return (
    <DirectionProvider direction="rtl">
      <div lang="ar" dir="rtl" className="grid w-80 gap-6">
        <div className="grid gap-3">
          {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
            <Field key={size} name={`rtl-${size}`}>
              <FieldLabel className="flex items-center justify-between gap-3">
                <span>{`تبديل (${size})`}</span>
                <Switch size={size} defaultChecked={false} />
              </FieldLabel>
            </Field>
          ))}
        </div>
        <div className="grid gap-3">
          {(['md', 'lg'] as const).flatMap((size) =>
            [false, true].map((checked) => (
              <Field key={`${size}-${checked}`} name={`rtl-loading-${size}-${checked}`}>
                <FieldLabel className="flex items-center justify-between gap-3">
                  <span>{`جارٍ التحميل — ${checked ? 'مفعّل' : 'متوقف'} (${size})`}</span>
                  <Switch size={size} checked={checked} loading />
                </FieldLabel>
              </Field>
            )),
          )}
        </div>
      </div>
    </DirectionProvider>
  )
}

export const RTL: Story = {
  render: () => <RTLDemo />,
  parameters: {
    docs: {
      story: { autoplay: false },
      description: {
        story:
          'Set both DirectionProvider and HTML dir to rtl. Checked thumbs move left and stay inside the track in every size. Loading indicators remain opposite the thumb in md and lg sizes.',
      },
    },
  },
  play: async ({ canvas, userEvent }) => {
    for (const size of ['xs', 'sm', 'md', 'lg']) {
      const control = canvas.getByRole('switch', { name: `تبديل (${size})` })
      const thumb = control.querySelector('span')!
      const trackBounds = control.getBoundingClientRect()
      const uncheckedBounds = thumb.getBoundingClientRect()

      await expect(control).not.toBeChecked()
      await expect(uncheckedBounds.right).toBeLessThanOrEqual(trackBounds.right)
      await userEvent.click(control)
      await expect(control).toBeChecked()
      await Promise.all(
        control.getAnimations({ subtree: true }).map((animation) => animation.finished),
      )
      const checkedBounds = thumb.getBoundingClientRect()
      await expect(checkedBounds.left).toBeLessThan(uncheckedBounds.left)
      await expect(checkedBounds.left).toBeGreaterThanOrEqual(trackBounds.left)
      await expect(checkedBounds.right).toBeLessThanOrEqual(trackBounds.right)

      await userEvent.keyboard(' ')
      await expect(control).not.toBeChecked()
      await Promise.all(
        control.getAnimations({ subtree: true }).map((animation) => animation.finished),
      )
      await expect(thumb.getBoundingClientRect().left).toBeCloseTo(uncheckedBounds.left)
    }

    for (const size of ['md', 'lg']) {
      for (const state of ['off', 'on']) {
        const control = canvas.getByRole('switch', {
          name: `جارٍ التحميل — ${state === 'on' ? 'مفعّل' : 'متوقف'} (${size})`,
        })
        await expect(control).toHaveAttribute('aria-disabled', 'true')
        await expect(control).toHaveAttribute('aria-checked', String(state === 'on'))
        const [thumb, spinner] = control.querySelectorAll('span')
        const trackBounds = control.getBoundingClientRect()
        const thumbBounds = thumb!.getBoundingClientRect()
        const spinnerBounds = spinner!.getBoundingClientRect()
        for (const bounds of [thumbBounds, spinnerBounds]) {
          await expect(bounds.left).toBeGreaterThanOrEqual(trackBounds.left)
          await expect(bounds.right).toBeLessThanOrEqual(trackBounds.right)
        }
        await expect(
          state === 'on'
            ? thumbBounds.right <= spinnerBounds.left
            : spinnerBounds.right <= thumbBounds.left,
        ).toBe(true)
      }
    }
  },
}

function LoadingDemo() {
  const [loading, setLoading] = React.useState(true)

  return (
    <div className="flex flex-col items-center space-y-4">
      <button
        className="rounded-sm border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        onClick={() => setLoading(!loading)}
      >
        {loading ? 'Stop Loading' : 'Start Loading'}
      </button>
      <div className="space-y-3">
        <Field name="largeUncheckedLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="lg" checked={false} loading={loading} />
            Large unchecked
          </FieldLabel>
        </Field>
        <Field name="largeCheckedLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="lg" checked={true} loading={loading} />
            Large checked
          </FieldLabel>
        </Field>
        <Field name="regularUncheckedLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="md" checked={false} loading={loading} />
            Regular unchecked
          </FieldLabel>
        </Field>
        <Field name="regularCheckedLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="md" checked={true} loading={loading} />
            Regular checked
          </FieldLabel>
        </Field>
        <Field name="smallLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="sm" checked={false} loading={loading} />
            Small
          </FieldLabel>
        </Field>
        <Field name="extraSmallLoading">
          <FieldLabel className="flex items-center gap-3">
            <Switch size="xs" checked={false} loading={loading} />
            Extra Small
          </FieldLabel>
        </Field>
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
    if (isPending) return

    startTransition(async () => {
      setRequestCount((current) => current + 1)
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

function MutationLoadingDemo() {
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
      <Field name="autoRetry">
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
      </Field>

      <span className="text-xs text-text-tertiary" aria-live="polite">
        {statusText} Save attempts: {updateAutoRetrySetting.requestCount}
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

function SkeletonDemo() {
  return (
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
}

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
  render: (args) => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    checked: false,
    disabled: false,
    loading: false,
  },
}
