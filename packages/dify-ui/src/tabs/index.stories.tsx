import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import {
  Tabs,
  TabsDivider,
  TabsList,
  TabsTab,
} from '.'

const meta = {
  title: 'Base/UI/Tabs',
  component: Tabs,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Composable tabs built on Base UI. The default visual style matches the Dify segmented control, while `TabsDivider` remains an explicit child so callers decide when dividers exist.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

type SegmentedTabsProps = {
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

function SegmentedTabs({
  defaultValue,
  values,
  iconOnly = false,
  noPadding = false,
}: SegmentedTabsProps) {
  return (
    <Tabs defaultValue={defaultValue}>
      <TabsList
        className={noPadding ? 'rounded-lg border-[0.5px] border-divider-subtle p-0' : undefined}
      >
        {values.map((itemValue, index) => (
          <span key={itemValue} className="relative flex items-center">
            <TabsTab
              value={itemValue}
              aria-label={iconOnly ? `Item ${index + 1}` : undefined}
            >
              <Icon />
              {!iconOnly && (
                <span className="px-0.5">Item</span>
              )}
            </TabsTab>
            {index === 1 && (
              <span className="pointer-events-none absolute top-0 -right-px flex h-full items-center" aria-hidden="true">
                <TabsDivider />
              </span>
            )}
          </span>
        ))}
      </TabsList>
    </Tabs>
  )
}

function SpecColumn() {
  const values = ['one', 'two', 'three']

  return (
    <div className="flex flex-col items-center gap-6">
      <SegmentedTabs defaultValue="one" values={values} />
      <SegmentedTabs defaultValue="one" values={values} iconOnly />
      <SegmentedTabs defaultValue="one" values={values} noPadding />
      <SegmentedTabs defaultValue="one" values={values} iconOnly noPadding />
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
        story: 'Figma node 2473:9851: segmented tab examples with text+icon and icon-only rows, with and without outer padding. Use the Storybook theme switcher to view the dark token rendering from node 2473:9856.',
      },
    },
  },
}

export const DataAttributeStates: Story = {
  render: () => (
    <div className="flex flex-col gap-5">
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTab value="default">
            <Item />
          </TabsTab>
          <TabsTab value="active">
            <Item />
          </TabsTab>
          <TabsTab value="disabled" disabled>
            <Item />
          </TabsTab>
        </TabsList>
      </Tabs>

      <Tabs defaultValue="accent-light">
        <TabsList>
          <TabsTab value="accent-light">
            <Item />
          </TabsTab>
          <TabsTab
            value="neutral"
            className="data-active:text-text-primary"
          >
            <Item />
          </TabsTab>
          <TabsTab
            value="accent"
            className="data-active:border-components-segmented-control-item-active-accent-border data-active:bg-components-segmented-control-item-active-accent-bg data-active:text-text-accent"
          >
            <Item />
          </TabsTab>
        </TabsList>
      </Tabs>

    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: '`TabsTab` gets `data-active` and `data-disabled` from Base UI. Accent and neutral active styles stay composable through `className` instead of adding variant props.',
      },
    },
  },
}
