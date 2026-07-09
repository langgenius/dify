import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import {
  Checkbox,
  CheckboxSkeleton,
} from '.'

const meta = {
  title: 'Base/Form/Checkbox',
  component: Checkbox,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Checkbox primitive built on Base UI. It preserves Base UI checked, indeterminate, disabled, and hidden input semantics while applying the Dify 16px checkbox design from Figma. Import from `@langgenius/dify-ui/checkbox`.',
      },
    },
  },
  tags: ['autodocs'],
  args: {
    checked: false,
    disabled: false,
    indeterminate: false,
  },
  argTypes: {
    checked: {
      control: 'boolean',
      description: 'Controlled checked state.',
    },
    indeterminate: {
      control: 'boolean',
      description: 'Mixed state used by parent or select-all checkboxes.',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables user interaction and exposes Base UI disabled state attributes.',
    },
  },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

function CheckboxDemo(args: Partial<React.ComponentProps<typeof Checkbox>>) {
  const [checked, setChecked] = React.useState(args.checked ?? false)

  return (
    <label className="flex items-center gap-2 system-sm-medium text-text-secondary">
      <Checkbox
        {...args}
        checked={checked}
        onCheckedChange={setChecked}
      />
      Enable feature
    </label>
  )
}

export const Default: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: false,
    indeterminate: false,
    disabled: false,
  },
}

export const Checked: Story = {
  render: args => <CheckboxDemo {...args} />,
  args: {
    checked: true,
    indeterminate: false,
    disabled: false,
  },
}

export const Indeterminate: Story = {
  args: {
    'checked': false,
    'indeterminate': true,
    'disabled': false,
    'aria-label': 'Partial selection',
  },
}

export const Disabled: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 system-sm-medium text-text-secondary">
        <Checkbox checked={false} disabled />
        Disabled unchecked
      </label>
      <label className="flex items-center gap-2 system-sm-medium text-text-secondary">
        <Checkbox checked disabled />
        Disabled checked
      </label>
      <label className="flex items-center gap-2 system-sm-medium text-text-secondary">
        <Checkbox checked={false} indeterminate disabled />
        Disabled mixed
      </label>
    </div>
  ),
}

function StateMatrixDemo() {
  const states = [
    { label: 'Unchecked', checked: false },
    { label: 'Checked', checked: true },
    { label: 'Indeterminate', checked: false, indeterminate: true },
    { label: 'Disabled unchecked', checked: false, disabled: true },
    { label: 'Disabled checked', checked: true, disabled: true },
    { label: 'Disabled indeterminate', checked: false, indeterminate: true, disabled: true },
  ]

  return (
    <div className="flex flex-col gap-3">
      {states.map(state => (
        <label key={state.label} className="flex items-center gap-2 system-sm-medium text-text-secondary">
          <Checkbox
            checked={state.checked}
            indeterminate={state.indeterminate}
            disabled={state.disabled}
          />
          {state.label}
        </label>
      ))}
      <div className="flex items-center gap-2 system-sm-medium text-text-secondary">
        <CheckboxSkeleton aria-hidden="true" />
        Skeleton
      </div>
    </div>
  )
}

export const StateMatrix: Story = {
  render: () => <StateMatrixDemo />,
  parameters: {
    docs: {
      description: {
        story: 'The full visual matrix for Dify checkbox states. State styling comes from Base UI data attributes such as data-checked, data-indeterminate, and data-disabled.',
      },
    },
  },
}
