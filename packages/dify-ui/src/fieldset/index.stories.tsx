import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox } from '../checkbox'
import { CheckboxGroup } from '../checkbox-group'
import { FieldItem, FieldLabel, FieldRoot } from '../field'
import {
  FieldsetLegend,
  FieldsetRoot,
} from './index'

const meta = {
  title: 'Base/Form/Fieldset',
  component: FieldsetRoot,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Fieldset primitives built on Base UI Fieldset. Use FieldsetRoot and FieldsetLegend when one field is represented by a group of related controls such as checkbox groups, radio groups, or multi-thumb sliders. Fieldset provides group semantics and labeling; pass interactive state such as disabled and value to the actual group primitive.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof FieldsetRoot>

export default meta

type Story = StoryObj<typeof meta>

export const CheckboxGroupField: Story = {
  render: () => (
    <FieldRoot name="scopes" className="w-80">
      <FieldsetRoot render={<CheckboxGroup defaultValue={['read']} />}>
        <FieldsetLegend>Scopes</FieldsetLegend>
        <div className="grid gap-2">
          <FieldItem>
            <FieldLabel className="flex items-center gap-2">
              <Checkbox value="read" />
              Read
            </FieldLabel>
          </FieldItem>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2">
              <Checkbox value="write" />
              Write
            </FieldLabel>
          </FieldItem>
          <FieldItem>
            <FieldLabel className="flex items-center gap-2">
              <Checkbox value="admin" />
              Admin
            </FieldLabel>
          </FieldItem>
        </div>
      </FieldsetRoot>
    </FieldRoot>
  ),
}
