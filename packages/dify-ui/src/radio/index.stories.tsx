import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { Radio, RadioControl, RadioGroup, RadioItem, RadioSkeleton } from '.'
import { Field, FieldDescription, FieldItem, FieldLabel } from '../field'
import { Fieldset, FieldsetLegend } from '../fieldset'

const meta = {
  title: 'Base/Form/Radio',
  component: RadioGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          '`@langgenius/dify-ui/radio` exports the complete radio family. `RadioGroup` owns single-selection state, `Radio` is the default Dify control for plain form rows, `RadioItem` makes custom UI the radio item, and `RadioControl` renders the standard visual dot inside custom items.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

function StandardFormRowsDemo() {
  const [value, setValue] = React.useState('vector')

  return (
    <Field name="retrievalIndex" className="w-80">
      <Fieldset
        render={
          <RadioGroup
            value={value}
            onValueChange={setValue}
            className="flex-col items-start gap-3"
          />
        }
      >
        <FieldsetLegend>Retrieval index</FieldsetLegend>
        {[
          { value: 'vector', label: 'Vector storage' },
          { value: 'keyword', label: 'Keyword index' },
          { value: 'hybrid', label: 'Hybrid retrieval' },
        ].map((option) => (
          <FieldItem key={option.value}>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value={option.value} />
              {option.label}
            </FieldLabel>
          </FieldItem>
        ))}
      </Fieldset>
    </Field>
  )
}

export const StandardFormRows: Story = {
  render: () => <StandardFormRowsDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Plain form-row composition. `RadioGroup` owns value, `FieldsetLegend` names the group, `FieldLabel` makes each option label clickable, and `Radio` renders the default dot.',
      },
    },
  },
}

function BooleanInlineDemo() {
  const [value, setValue] = React.useState(true)

  return (
    <Field name="streaming" className="w-80">
      <Fieldset
        render={<RadioGroup<boolean> value={value} onValueChange={setValue} className="gap-3" />}
      >
        <FieldsetLegend>Streaming output</FieldsetLegend>
        <div className="flex items-center gap-3">
          <FieldItem>
            <FieldLabel className="flex items-center gap-1.5 system-sm-regular text-text-secondary">
              <Radio<boolean> value={true} />
              True
            </FieldLabel>
          </FieldItem>
          <FieldItem>
            <FieldLabel className="flex items-center gap-1.5 system-sm-regular text-text-secondary">
              <Radio<boolean> value={false} />
              False
            </FieldLabel>
          </FieldItem>
        </div>
      </Fieldset>
    </Field>
  )
}

export const BooleanInline: Story = {
  render: () => <BooleanInlineDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Compact boolean radio fields. Type `RadioGroup<boolean>` and each child `Radio<boolean>` when the selected value is not a string.',
      },
    },
  },
}

type PromptMode = 'default' | 'custom'

function OptionCardsDemo() {
  const [value, setValue] = React.useState<PromptMode>('default')

  const options = [
    {
      value: 'default',
      title: 'Default prompt',
      description: 'Use the built-in prompt for consistent output.',
    },
    {
      value: 'custom',
      title: 'Custom prompt',
      description: 'Write a prompt for this app and keep full control.',
    },
  ] satisfies Array<{
    value: PromptMode
    title: string
    description: string
  }>

  return (
    <Field name="promptMode" className="w-100">
      <Fieldset
        render={
          <RadioGroup<PromptMode>
            value={value}
            onValueChange={setValue}
            className="flex-col items-stretch gap-3"
          />
        }
      >
        <FieldsetLegend>Prompt mode</FieldsetLegend>
        {options.map((option) => (
          <FieldItem key={option.value}>
            <RadioItem<PromptMode>
              value={option.value}
              nativeButton
              render={<button type="button" />}
              className="w-full rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-4 text-left outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="system-sm-semibold text-text-primary">{option.title}</div>
                  <div className="mt-1 system-xs-regular text-text-tertiary">
                    {option.description}
                  </div>
                </div>
                <RadioControl aria-hidden="true" />
              </div>
            </RadioItem>
          </FieldItem>
        ))}
      </Fieldset>
    </Field>
  )
}

export const OptionCards: Story = {
  render: () => <OptionCardsDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Custom option UIs should make the whole interactive surface the radio item with `RadioItem`. `RadioControl` is the Dify visual dot; the radio semantics stay on `RadioItem`.',
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
  const [selected, setSelected] = React.useState('automatic')

  return (
    <Field name="generation_mode" className="flex w-80 flex-col gap-2">
      <FieldDescription className="body-xs-regular text-text-tertiary">
        This mirrors Dify dynamic form fields where radio options are controlled by schema and
        persisted as a single value.
      </FieldDescription>
      <Fieldset
        render={
          <RadioGroup
            value={selected}
            onValueChange={setSelected}
            className="flex-col items-start gap-2 rounded-lg border border-components-panel-border bg-components-panel-bg p-3"
          />
        }
      >
        <FieldsetLegend className="system-sm-medium text-text-secondary">
          Generation mode
        </FieldsetLegend>
        {options.map((option) => (
          <FieldItem key={option.value}>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value={option.value} />
              {option.label}
            </FieldLabel>
          </FieldItem>
        ))}
      </Fieldset>
    </Field>
  )
}

export const DynamicFormField: Story = {
  render: () => <DynamicFormFieldDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Matches Dify form composition: Field and Fieldset provide group labeling while `RadioGroup` owns controlled single-selection state.',
      },
    },
  },
}

export const StateMatrix: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Field name="radioStates">
        <Fieldset
          render={<RadioGroup defaultValue="checked" className="flex-col items-start gap-3" />}
        >
          <FieldsetLegend>Interactive radio states</FieldsetLegend>
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
        </Fieldset>
      </Field>
      <Field name="disabledRadioStates">
        <Fieldset
          render={
            <RadioGroup
              defaultValue="disabled-checked"
              disabled
              className="flex-col items-start gap-3"
            />
          }
        >
          <FieldsetLegend>Disabled radio states</FieldsetLegend>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value="disabled-unchecked" />
              Disabled unchecked
            </FieldLabel>
          </FieldItem>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Radio value="disabled-checked" />
              Disabled checked
            </FieldLabel>
          </FieldItem>
        </Fieldset>
      </Field>
      <div className="flex items-center gap-2 system-sm-medium text-text-secondary">
        <RadioSkeleton aria-hidden="true" />
        Skeleton
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The visual matrix for Dify radio states. State styling comes from Base UI data attributes such as data-checked and data-disabled.',
      },
    },
  },
}
