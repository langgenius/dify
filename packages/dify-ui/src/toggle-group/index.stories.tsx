import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import {
  ToggleGroup,
  ToggleGroupDivider,
  ToggleGroupItem,
} from '.'

const meta = {
  title: 'Base/UI/ToggleGroup',
  component: ToggleGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Segmented control built on Base UI ToggleGroup and Toggle. Use this for mode, filter, and view selection that does not need tabpanel semantics.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

type SegmentedControlProps = {
  defaultValue: string
  values: string[]
  iconOnly?: boolean
  noPadding?: boolean
}

const Icon = () => (
  <i className="i-ri-information-line size-4 shrink-0" aria-hidden="true" />
)

const Item = () => (
  <>
    <Icon />
    <span className="px-0.5">Item</span>
  </>
)

function SegmentedControl({
  defaultValue,
  values,
  iconOnly = false,
  noPadding = false,
}: SegmentedControlProps) {
  return (
    <ToggleGroup
      defaultValue={[defaultValue]}
      aria-label="Segmented control"
      className={noPadding ? 'rounded-lg border-[0.5px] border-divider-subtle p-0' : undefined}
    >
      {values.map((itemValue, index) => (
        <span key={itemValue} className="relative flex items-center">
          <ToggleGroupItem
            value={itemValue}
            aria-label={iconOnly ? `Item ${index + 1}` : undefined}
          >
            <Icon />
            {!iconOnly && (
              <span className="px-0.5">Item</span>
            )}
          </ToggleGroupItem>
          {index === 1 && (
            <span className="pointer-events-none absolute top-0 -right-px flex h-full items-center" aria-hidden="true">
              <ToggleGroupDivider />
            </span>
          )}
        </span>
      ))}
    </ToggleGroup>
  )
}

function SpecColumn() {
  const values = ['one', 'two', 'three']

  return (
    <div className="flex flex-col items-center gap-6">
      <SegmentedControl defaultValue="one" values={values} />
      <SegmentedControl defaultValue="one" values={values} iconOnly />
      <SegmentedControl defaultValue="one" values={values} noPadding />
      <SegmentedControl defaultValue="one" values={values} iconOnly noPadding />
    </div>
  )
}

function SpecPanel({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <div className="flex min-h-105 items-center justify-center">
        {children}
      </div>
    </div>
  )
}

export const DesignSpec: Story = {
  render: () => (
    <div className="overflow-hidden rounded-3xl bg-components-panel-bg-alt p-4">
      <SpecPanel className="w-120 overflow-hidden rounded-2xl bg-components-chart-bg">
        <SpecColumn />
      </SpecPanel>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Figma node 2473:9851: segmented control examples with text+icon and icon-only rows, with and without outer padding.',
      },
    },
  },
}

export const DataAttributeStates: Story = {
  render: () => (
    <div className="flex flex-col gap-5">
      <ToggleGroup defaultValue={['active']} aria-label="Basic states">
        <ToggleGroupItem value="default">
          <Item />
        </ToggleGroupItem>
        <ToggleGroupItem value="active">
          <Item />
        </ToggleGroupItem>
        <ToggleGroupItem value="disabled" disabled>
          <Item />
        </ToggleGroupItem>
      </ToggleGroup>

      <ToggleGroup defaultValue={['accent-light']} aria-label="Active states">
        <ToggleGroupItem value="accent-light">
          <Item />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="neutral"
          className="data-pressed:text-text-primary"
        >
          <Item />
        </ToggleGroupItem>
        <ToggleGroupItem
          value="accent"
          className="data-pressed:border-components-segmented-control-item-active-accent-border data-pressed:bg-components-segmented-control-item-active-accent-bg data-pressed:text-text-accent"
        >
          <Item />
        </ToggleGroupItem>
      </ToggleGroup>

      <ToggleGroup defaultValue={['one', 'three']} multiple aria-label="Multiple selection">
        <ToggleGroupItem value="one">
          <Item />
        </ToggleGroupItem>
        <ToggleGroupItem value="two">
          <Item />
        </ToggleGroupItem>
        <ToggleGroupItem value="three">
          <Item />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: '`ToggleGroupItem` gets `data-pressed` and `data-disabled` from Base UI. Accent, neutral, and multiple-selection examples are composed through props and className.',
      },
    },
  },
}
