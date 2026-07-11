import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../button'
import { Checkbox } from '../checkbox'
import { CheckboxGroup } from '../checkbox-group'
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldItem,
  FieldLabel,
} from '../field'
import { Fieldset, FieldsetLegend } from '../fieldset'
import { Form } from './index'

const meta = {
  title: 'Base/Form/Form',
  component: Form,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Form>

export default meta

type Story = StoryObj<typeof meta>

export const Basic: Story = {
  render: () => (
    <Form className="grid w-96 gap-4" onFormSubmit={() => undefined}>
      <Field name="name">
        <FieldLabel>Name</FieldLabel>
        <FieldControl required placeholder="Enter a name" />
        <FieldError match="valueMissing">Name is required.</FieldError>
      </Field>

      <Field name="email">
        <FieldLabel>Email</FieldLabel>
        <FieldControl type="email" required placeholder="name@example.com" />
        <FieldDescription>Used for account notifications.</FieldDescription>
        <FieldError match="valueMissing">Email is required.</FieldError>
        <FieldError match="typeMismatch">Enter a valid email address.</FieldError>
      </Field>

      <Field name="features">
        <Fieldset render={<CheckboxGroup defaultValue={['search']} />}>
          <FieldsetLegend>Features</FieldsetLegend>
          <div className="grid gap-2">
            <FieldItem>
              <FieldLabel className="flex items-center gap-2">
                <Checkbox value="search" />
                Search
              </FieldLabel>
            </FieldItem>
            <FieldItem>
              <FieldLabel className="flex items-center gap-2">
                <Checkbox value="analytics" />
                Analytics
              </FieldLabel>
            </FieldItem>
          </div>
        </Fieldset>
      </Field>

      <div className="flex justify-end">
        <Button type="submit" variant="primary">Save</Button>
      </div>
    </Form>
  ),
}
