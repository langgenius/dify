import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { CheckboxGroup } from '.'
import { Checkbox } from '../checkbox'
import {
  FieldDescription,
  FieldItem,
  FieldLabel,
  FieldRoot,
} from '../field'
import { FieldsetLegend, FieldsetRoot } from '../fieldset'

const meta = {
  title: 'Base/Form/CheckboxGroup',
  component: CheckboxGroup,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'CheckboxGroup primitive built on Base UI. It owns multi-checkbox array state, allValues, and parent checkbox semantics. Import from `@langgenius/dify-ui/checkbox-group` and compose with `Checkbox` from `@langgenius/dify-ui/checkbox`.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CheckboxGroup>

export default meta
type Story = StoryObj<typeof meta>

function DocumentSelectionDemo() {
  const documentIds = ['doc-1', 'doc-2', 'doc-3']
  const [selected, setSelected] = React.useState<string[]>(['doc-1'])
  const groupLabelId = React.useId()

  return (
    <CheckboxGroup
      aria-labelledby={groupLabelId}
      value={selected}
      onValueChange={setSelected}
      allValues={documentIds}
      className="flex flex-col gap-3"
    >
      <label id={groupLabelId} className="flex items-center gap-2 system-sm-semibold-uppercase text-text-secondary">
        <Checkbox parent />
        Current page documents
      </label>
      <div className="flex flex-col gap-2 pl-6">
        {[
          { id: 'doc-1', name: 'onboarding-guide.pdf' },
          { id: 'doc-2', name: 'pricing-faq.md' },
          { id: 'doc-3', name: 'release-notes.txt' },
        ].map(document => (
          <label key={document.id} className="flex items-center gap-2 system-sm-medium text-text-secondary">
            <Checkbox value={document.id} />
            {document.name}
          </label>
        ))}
      </div>
    </CheckboxGroup>
  )
}

export const DocumentSelection: Story = {
  render: () => <DocumentSelectionDemo />,
  parameters: {
    docs: {
      description: {
        story: 'Matches Dify table/list selection patterns such as documents, segments, annotations, and install bundle items: CheckboxGroup owns the selected ID array, allValues defines the current selectable page, and the parent checkbox provides select-all plus mixed state.',
      },
    },
  },
}

function DynamicFormFieldDemo() {
  const options = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'pdf', label: 'PDF' },
    { value: 'html', label: 'HTML' },
  ]
  const [selected, setSelected] = React.useState<string[]>(['markdown'])

  return (
    <FieldRoot name="allowed_file_types" className="flex w-80 flex-col gap-2">
      <FieldDescription className="body-xs-regular text-text-tertiary">
        This mirrors Dify dynamic form fields where checkbox options are controlled by schema and persisted as a string array.
      </FieldDescription>
      <FieldsetRoot
        render={(
          <CheckboxGroup
            value={selected}
            onValueChange={setSelected}
            className="flex flex-col gap-2 rounded-lg border border-components-panel-border bg-components-panel-bg p-3"
          />
        )}
      >
        <FieldsetLegend className="system-sm-medium text-text-secondary">
          Allowed file types
        </FieldsetLegend>
        {options.map(option => (
          <FieldItem key={option.value}>
            <FieldLabel className="flex items-center gap-2 system-sm-medium text-text-secondary">
              <Checkbox value={option.value} />
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
        story: 'Matches Dify checkbox-list form usage in workflow node forms and base form rendering. Field and Fieldset provide group labeling; CheckboxGroup owns controlled array state.',
      },
    },
  },
}
