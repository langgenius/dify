import type { Meta, StoryObj } from '@storybook/react-vite'
import * as React from 'react'
import { Button } from '../button'
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from '../field'
import { Form } from '../form'
import { Textarea } from './index'

const meta = {
  title: 'Base/Form/Textarea',
  component: Textarea,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Multiline text control built on Base UI Field.Control. Use it with FieldRoot for labelled, described, and validated form fields.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Textarea>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <div className="w-80">
      <label htmlFor="workspace-description" className="mb-1 block w-fit py-1 text-text-secondary system-sm-medium">
        Workspace description
      </label>
      <Textarea
        id="workspace-description"
        name="workspaceDescription"
        placeholder="Describe how this workspace is used..."
      />
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <label className="grid gap-1 text-text-secondary system-sm-medium" htmlFor="small-textarea">
        Small
        <Textarea id="small-textarea" size="small" name="smallTextarea" placeholder="Short note..." rows={3} />
      </label>
      <label className="grid gap-1 text-text-secondary system-sm-medium" htmlFor="medium-textarea">
        Medium
        <Textarea id="medium-textarea" name="mediumTextarea" placeholder="Add context..." rows={3} />
      </label>
      <label className="grid gap-1 text-text-secondary system-sm-medium" htmlFor="large-textarea">
        Large
        <Textarea id="large-textarea" size="large" name="largeTextarea" placeholder="Write a longer instruction..." rows={3} />
      </label>
    </div>
  ),
}

export const States: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <FieldRoot name="placeholderState">
        <FieldLabel>Placeholder</FieldLabel>
        <Textarea placeholder="Add a description..." rows={3} />
      </FieldRoot>
      <FieldRoot name="filledState">
        <FieldLabel>Filled</FieldLabel>
        <Textarea defaultValue="Use this dataset for support articles and product FAQs." rows={3} />
      </FieldRoot>
      <FieldRoot name="invalidState" invalid>
        <FieldLabel>Invalid</FieldLabel>
        <Textarea defaultValue="Too short" rows={3} />
        <FieldError match>Use at least 20 characters.</FieldError>
      </FieldRoot>
      <FieldRoot name="disabledState">
        <FieldLabel>Disabled</FieldLabel>
        <Textarea disabled placeholder="Editing is unavailable..." rows={3} />
      </FieldRoot>
      <FieldRoot name="readonlyState">
        <FieldLabel>Read-only</FieldLabel>
        <Textarea readOnly defaultValue="Generated from the published workflow configuration." rows={3} />
      </FieldRoot>
    </div>
  ),
}

const FormDemo = () => {
  const [savedDescription, setSavedDescription] = React.useState<string | null>(null)

  return (
    <Form
      aria-label="Dataset settings"
      className="grid w-80 gap-4"
      onFormSubmit={(values) => {
        setSavedDescription(String(values.description ?? ''))
      }}
    >
      <FieldRoot name="description">
        <FieldLabel>Description</FieldLabel>
        <Textarea
          required
          minLength={20}
          maxLength={160}
          placeholder="Describe what this dataset contains..."
          rows={4}
          className="resize-y"
        />
        <FieldDescription>Shown to teammates when they choose a knowledge source.</FieldDescription>
        <FieldError match="valueMissing">Description is required.</FieldError>
        <FieldError match="tooShort">Use at least 20 characters.</FieldError>
      </FieldRoot>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">Save Settings</Button>
      </div>
      {savedDescription && (
        <div className="rounded-lg bg-background-section px-3 py-2 text-text-secondary system-xs-regular">
          Saved:
          {' '}
          {savedDescription}
        </div>
      )}
    </Form>
  )
}

export const WithField: Story = {
  render: () => <FormDemo />,
}

const ControlledDemo = () => {
  const [value, setValue] = React.useState('Summarize customer feedback into actionable product themes.')

  return (
    <FieldRoot name="prompt">
      <FieldLabel>Prompt</FieldLabel>
      <Textarea
        value={value}
        onValueChange={nextValue => setValue(nextValue)}
        rows={4}
        className="resize-y"
      />
      <FieldDescription>The saved value is updated from the controlled state.</FieldDescription>
    </FieldRoot>
  )
}

export const Controlled: Story = {
  render: () => (
    <div className="w-80">
      <ControlledDemo />
    </div>
  ),
}

const CharacterCounterDemo = () => {
  const maxLength = 120
  const [value, setValue] = React.useState('Summarize customer feedback into actionable product themes.')

  return (
    <FieldRoot name="limitedPrompt">
      <FieldLabel>Prompt</FieldLabel>
      <div className="relative">
        <Textarea
          value={value}
          onValueChange={nextValue => setValue(nextValue)}
          maxLength={maxLength}
          rows={4}
          className="resize-y pb-8"
        />
        <div className="pointer-events-none absolute right-2 bottom-2 flex h-5 items-center rounded-md bg-background-section px-1 text-text-quaternary system-xs-medium">
          <span>{value.length}</span>
          /
          <span className="text-text-tertiary">{maxLength}</span>
        </div>
      </div>
      <FieldDescription>Character counters are composed at the usage site when the workflow needs one.</FieldDescription>
    </FieldRoot>
  )
}

export const WithCharacterCounter: Story = {
  render: () => (
    <div className="w-80">
      <CharacterCounterDemo />
    </div>
  ),
}
