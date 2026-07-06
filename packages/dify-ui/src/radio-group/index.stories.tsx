import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { RadioGroup } from '.'
import {
  FieldDescription,
  FieldItem,
  FieldLabel,
  FieldRoot,
} from '../field'
import { FieldsetLegend, FieldsetRoot } from '../fieldset'
import { Radio, RadioControl, RadioIndicator, RadioRoot } from '../radio'

const meta = {
  title: 'Base/Form/RadioGroup',
  component: RadioGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: '`RadioGroup` owns single-selection state. Use `Radio` for plain form rows, `RadioRoot` when an entire row or card is the radio item, `RadioControl` for the standard visual dot inside custom roots, and `RadioIndicator` only when the design owns a custom control shell.',
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
    <FieldRoot name="retrievalIndex" className="w-80">
      <FieldsetRoot
        render={(
          <RadioGroup value={value} onValueChange={setValue} className="flex-col items-start gap-3" />
        )}
      >
        <FieldsetLegend>Retrieval index</FieldsetLegend>
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

export const StandardFormRows: Story = {
  render: () => <StandardFormRowsDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Plain form-row composition. `RadioGroup` owns value, `FieldsetLegend` names the group, `FieldLabel` makes each option label clickable, and `Radio` renders the default dot.',
      },
    },
  },
}

function BooleanInlineDemo() {
  const [value, setValue] = React.useState(true)

  return (
    <FieldRoot name="streaming" className="w-80">
      <FieldsetRoot
        render={(
          <RadioGroup<boolean> value={value} onValueChange={setValue} className="gap-3" />
        )}
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
      </FieldsetRoot>
    </FieldRoot>
  )
}

export const BooleanInline: Story = {
  render: () => <BooleanInlineDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Compact boolean radio fields. This is the pattern used by model parameters and dynamic boolean schema fields.',
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
    <FieldRoot name="promptMode" className="w-100">
      <FieldsetRoot
        render={(
          <RadioGroup<PromptMode> value={value} onValueChange={setValue} className="flex-col items-stretch gap-3" />
        )}
      >
        <FieldsetLegend>Prompt mode</FieldsetLegend>
        {options.map(option => (
          <FieldItem key={option.value}>
            <RadioRoot<PromptMode>
              value={option.value}
              variant="unstyled"
              nativeButton
              render={<button type="button" />}
              className="w-full rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-4 text-left outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="system-sm-semibold text-text-primary">
                    {option.title}
                  </div>
                  <div className="mt-1 system-xs-regular text-text-tertiary">
                    {option.description}
                  </div>
                </div>
                <RadioControl aria-hidden="true" />
              </div>
            </RadioRoot>
          </FieldItem>
        ))}
      </FieldsetRoot>
    </FieldRoot>
  )
}

export const OptionCards: Story = {
  render: () => <OptionCardsDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Product option cards should make the whole card the radio item with `RadioRoot variant="unstyled"`. `RadioControl` renders the standard visual dot inside the custom root.',
      },
    },
  },
}

type ApprovalMode = 'automatic' | 'manual'

function CustomIndicatorPartDemo() {
  const [value, setValue] = React.useState<ApprovalMode>('automatic')

  const options = [
    {
      value: 'automatic',
      title: 'Automatic approval',
      description: 'Approve requests that match policy.',
    },
    {
      value: 'manual',
      title: 'Manual review',
      description: 'Ask an admin to review each request.',
    },
  ] satisfies Array<{
    value: ApprovalMode
    title: string
    description: string
  }>

  return (
    <FieldRoot name="approvalMode" className="w-100">
      <FieldsetRoot
        render={(
          <RadioGroup<ApprovalMode> value={value} onValueChange={setValue} className="flex-col items-stretch gap-2" />
        )}
      >
        <FieldsetLegend>Approval mode</FieldsetLegend>
        {options.map(option => (
          <FieldItem key={option.value}>
            <RadioRoot<ApprovalMode>
              value={option.value}
              variant="unstyled"
              nativeButton
              render={<button type="button" />}
              className="flex w-full items-center gap-3 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2 text-left outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg"
            >
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-components-radio-border bg-components-radio-bg">
                <RadioIndicator className="text-components-radio-border-checked" />
              </span>
              <span className="min-w-0 grow">
                <span className="block truncate system-sm-semibold text-text-primary">
                  {option.title}
                </span>
                <span className="block truncate system-xs-regular text-text-tertiary">
                  {option.description}
                </span>
              </span>
            </RadioRoot>
          </FieldItem>
        ))}
      </FieldsetRoot>
    </FieldRoot>
  )
}

export const CustomIndicatorPart: Story = {
  render: () => <CustomIndicatorPartDemo />,
  parameters: {
    docs: {
      description: {
        story: '`RadioIndicator` is the low-level indicator part. Use it only when a custom root owns the outer control shell; otherwise prefer `Radio` for form rows or `RadioControl` inside option cards.',
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
