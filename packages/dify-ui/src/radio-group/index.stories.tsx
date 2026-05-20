import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { RadioGroup } from '.'
import {
  FieldDescription,
  FieldItem,
  FieldLabel,
  FieldRoot,
} from '../field'
import { FieldsetLegend, FieldsetRoot } from '../fieldset'
import { Radio } from '../radio'

const meta = {
  title: 'Base/Form/RadioGroup',
  component: RadioGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'RadioGroup primitive built on Base UI. It owns mutually exclusive radio state and form integration. Compose with `Radio` from `@langgenius/dify-ui/radio`; use Field and Fieldset when a group label, description, or error belongs to the selection.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

function StorageSelectionDemo() {
  const [value, setValue] = useState('vector')

  return (
    <FieldRoot name="storageType">
      <FieldsetRoot
        render={(
          <RadioGroup value={value} onValueChange={setValue} className="flex-col items-start gap-3" />
        )}
      >
        <FieldsetLegend>Storage type</FieldsetLegend>
        {[
          { value: 'vector', label: 'Vector storage' },
          { value: 'keyword', label: 'Keyword index' },
          { value: 'hybrid', label: 'Hybrid retrieval' },
        ].map(option => (
          <FieldItem key={option.value}>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value={option.value} />
              {option.label}
            </FieldLabel>
          </FieldItem>
        ))}
      </FieldsetRoot>
    </FieldRoot>
  )
}

export const StorageSelection: Story = {
  render: () => <StorageSelectionDemo />,
  parameters: {
    docs: {
      description: {
        story: 'A standalone radio group with implicit labels. Use this when the surrounding UI already provides the group name.',
      },
    },
  },
}

function DynamicFormFieldDemo() {
  const options = [
    { value: 'automatic', label: 'Automatic' },
    { value: 'high_quality', label: 'High quality' },
    { value: 'economy', label: 'Economy' },
  ]
  const [selected, setSelected] = useState('automatic')

  return (
    <FieldRoot name="generation_mode" className="flex w-80 flex-col gap-2">
      <FieldDescription className="body-xs-regular text-text-tertiary">
        This mirrors Dify dynamic form fields where radio options are controlled by schema and persisted as a single value.
      </FieldDescription>
      <FieldsetRoot
        render={(
          <RadioGroup
            value={selected}
            onValueChange={setSelected}
            className="flex-col items-start gap-2 rounded-lg border border-components-panel-border bg-components-panel-bg p-3"
          />
        )}
      >
        <FieldsetLegend className="system-sm-medium text-text-secondary">
          Generation mode
        </FieldsetLegend>
        {options.map(option => (
          <FieldItem key={option.value}>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value={option.value} />
              {option.label}
            </FieldLabel>
          </FieldItem>
        ))}
      </FieldsetRoot>
    </FieldRoot>
  )
}

export const DynamicFormField: Story = {
  render: () => <DynamicFormFieldDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Matches Dify form composition: Field and Fieldset provide group labeling while RadioGroup owns controlled single-selection state.',
      },
    },
  },
}
