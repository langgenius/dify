import { render } from 'vitest-browser-react'
import { Checkbox } from '../../checkbox'
import { CheckboxGroup } from '../../checkbox-group'
import { FieldItem, FieldLabel, FieldRoot } from '../../field'
import {
  FieldsetLegend,
  FieldsetRoot,
} from '../index'

describe('Fieldset primitives', () => {
  it('should render a named fieldset group with reset design-system classes', async () => {
    const screen = await render(
      <FieldsetRoot>
        <FieldsetLegend>Permissions</FieldsetLegend>
        <label>
          <input type="checkbox" />
          Read
        </label>
      </FieldsetRoot>,
    )

    await expect.element(screen.getByRole('group', { name: 'Permissions' })).toHaveClass('border-0', 'p-0')
    await expect.element(screen.getByText('Permissions')).toHaveClass('system-sm-medium', 'text-text-secondary')
  })

  it('should compose with checkbox groups through FieldRoot and FieldItem', async () => {
    const screen = await render(
      <FieldRoot name="scopes">
        <FieldsetRoot render={<CheckboxGroup value={['read']} />}>
          <FieldsetLegend>Scopes</FieldsetLegend>
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
        </FieldsetRoot>
      </FieldRoot>,
    )

    await expect.element(screen.getByRole('group', { name: 'Scopes' })).toBeInTheDocument()
    await expect.element(screen.getByRole('checkbox', { name: 'Read' })).toHaveAttribute('aria-checked', 'true')
    await expect.element(screen.getByRole('checkbox', { name: 'Write' })).toHaveAttribute('aria-checked', 'false')
  })

  it('should expose disabled state on root and legend', async () => {
    const screen = await render(
      <FieldsetRoot disabled>
        <FieldsetLegend>Disabled group</FieldsetLegend>
      </FieldsetRoot>,
    )

    await expect.element(screen.getByRole('group', { name: 'Disabled group' })).toHaveAttribute('data-disabled', '')
    await expect.element(screen.getByText('Disabled group')).toHaveAttribute('data-disabled', '')
  })
})
