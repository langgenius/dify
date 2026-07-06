import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import {
  Radio,
  RadioSkeleton,
} from '.'
import { FieldItem, FieldLabel, FieldRoot } from '../field'
import { FieldsetLegend, FieldsetRoot } from '../fieldset'
import { RadioGroup } from '../radio-group'

const meta = {
  title: 'Base/Form/Radio',
  component: Radio,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: '`Radio` is the default Dify 16px radio control, intended for plain form rows inside `RadioGroup`. It does not accept children. For custom radio items, use `RadioItem` and place `RadioControl` inside it when the standard dot is needed; see the `RadioGroup` stories.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    disabled: false,
    value: 'ssd',
  },
  argTypes: {
    disabled: {
      control: 'boolean',
      description: 'Disables user interaction and exposes Base UI disabled state attributes.',
    },
  },
} satisfies Meta<typeof Radio>

export default meta
type Story = StoryObj<typeof meta>

function RadioDemo(args: Partial<React.ComponentProps<typeof Radio>>) {
  const [value, setValue] = React.useState('ssd')

  return (
    <FieldRoot name="storageType">
      <FieldsetRoot
        render={(
          <RadioGroup value={value} onValueChange={setValue} className="flex-col items-start gap-3" />
        )}
      >
        <FieldsetLegend>Storage type</FieldsetLegend>
        <FieldItem>
          <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
            <Radio {...args} value="ssd" />
            SSD
          </FieldLabel>
        </FieldItem>
        <FieldItem>
          <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
            <Radio {...args} value="hdd" />
            HDD
          </FieldLabel>
        </FieldItem>
      </FieldsetRoot>
    </FieldRoot>
  )
}

export const Default: Story = {
  render: args => <RadioDemo {...args} />,
  args: {
    disabled: false,
  },
  parameters: {
    docs: {
      description: {
        story: '`Radio` renders the standard visual control. `FieldLabel` owns the clickable text label, and `RadioGroup` owns the selected value.',
      },
    },
  },
}

export const Disabled: Story = {
  args: {
    value: 'checked',
  },
  render: () => (
    <FieldRoot name="disabledStates">
      <FieldsetRoot render={<RadioGroup value="checked" className="flex-col items-start gap-3" />}>
        <FieldsetLegend>Disabled states</FieldsetLegend>
        <FieldItem>
          <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
            <Radio value="unchecked" disabled />
            Disabled unchecked
          </FieldLabel>
        </FieldItem>
        <FieldItem>
          <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
            <Radio value="checked" disabled />
            Disabled checked
          </FieldLabel>
        </FieldItem>
      </FieldsetRoot>
    </FieldRoot>
  ),
}

export const StateMatrix: Story = {
  args: {
    value: 'checked',
  },
  render: () => (
    <div className="flex flex-col gap-3">
      <FieldRoot name="radioStates">
        <FieldsetRoot render={<RadioGroup value="checked" className="flex-col items-start gap-3" />}>
          <FieldsetLegend>Radio states</FieldsetLegend>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value="unchecked" />
              Unchecked
            </FieldLabel>
          </FieldItem>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value="checked" />
              Checked
            </FieldLabel>
          </FieldItem>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value="disabled-unchecked" disabled />
              Disabled unchecked
            </FieldLabel>
          </FieldItem>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value="checked" disabled />
              Disabled checked
            </FieldLabel>
          </FieldItem>
        </FieldsetRoot>
      </FieldRoot>
      <div className="flex items-center gap-2 system-sm-medium text-text-secondary">
        <RadioSkeleton aria-hidden="true" />
        Skeleton
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'The full visual matrix for Dify radio states. State styling comes from Base UI data attributes such as data-checked and data-disabled.',
      },
    },
  },
}
