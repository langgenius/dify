import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import {
  SegmentedControl,
  SegmentedControlDivider,
  SegmentedControlItem,
} from '.'

const meta = {
  title: 'Base/UI/SegmentedControl',
  component: SegmentedControl,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Segmented control built on Base UI ToggleGroup and Toggle. Use it for mode, filter, and view selection that does not need tabpanel semantics.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SegmentedControl>

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
  <React.Fragment>
    <Icon />
    <span className="px-0.5">Item</span>
  </React.Fragment>
)

function SegmentedControlExample({
  defaultValue,
  values,
  iconOnly = false,
  noPadding = false,
}: SegmentedControlProps) {
  return (
    <SegmentedControl
      defaultValue={[defaultValue]}
      aria-label="Segmented control"
      className={noPadding ? 'rounded-lg border-[0.5px] border-divider-subtle p-0' : undefined}
    >
      {values.map((itemValue, index) => (
        <span key={itemValue} className="relative flex items-center">
          <SegmentedControlItem
            value={itemValue}
            aria-label={iconOnly ? `Item ${index + 1}` : undefined}
          >
            <Icon />
            {!iconOnly && (
              <span className="px-0.5">Item</span>
            )}
          </SegmentedControlItem>
          {index === 1 && (
            <span className="pointer-events-none absolute top-0 -right-px flex h-full items-center" aria-hidden="true">
              <SegmentedControlDivider />
            </span>
          )}
        </span>
      ))}
    </SegmentedControl>
  )
}

function SpecColumn() {
  const values = ['one', 'two', 'three']

  return (
    <div className="flex flex-col items-center gap-6">
      <SegmentedControlExample defaultValue="one" values={values} />
      <SegmentedControlExample defaultValue="one" values={values} iconOnly />
      <SegmentedControlExample defaultValue="one" values={values} noPadding />
      <SegmentedControlExample defaultValue="one" values={values} iconOnly noPadding />
    </div>
  )
}

function SpecPanel({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
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
      <SegmentedControl defaultValue={['active']} aria-label="Basic states">
        <SegmentedControlItem value="default">
          <Item />
        </SegmentedControlItem>
        <SegmentedControlItem value="active">
          <Item />
        </SegmentedControlItem>
        <SegmentedControlItem value="disabled" disabled>
          <Item />
        </SegmentedControlItem>
      </SegmentedControl>

      <SegmentedControl defaultValue={['accent-light']} aria-label="Active states">
        <SegmentedControlItem value="accent-light">
          <Item />
        </SegmentedControlItem>
        <SegmentedControlItem
          value="neutral"
          className="data-pressed:text-text-primary"
        >
          <Item />
        </SegmentedControlItem>
        <SegmentedControlItem
          value="accent"
          className="data-pressed:border-components-segmented-control-item-active-accent-border data-pressed:bg-components-segmented-control-item-active-accent-bg data-pressed:text-text-accent"
        >
          <Item />
        </SegmentedControlItem>
      </SegmentedControl>

      <SegmentedControl defaultValue={['one', 'three']} multiple aria-label="Multiple selection">
        <SegmentedControlItem value="one">
          <Item />
        </SegmentedControlItem>
        <SegmentedControlItem value="two">
          <Item />
        </SegmentedControlItem>
        <SegmentedControlItem value="three">
          <Item />
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: '`SegmentedControlItem` gets `data-pressed` and `data-disabled` from Base UI Toggle. Accent, neutral, and multiple-selection examples are composed through props and className.',
      },
    },
  },
}
