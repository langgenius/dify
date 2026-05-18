import { Field } from '@base-ui/react/field'
import { Fieldset } from '@base-ui/react/fieldset'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { Checkbox } from '../../checkbox'
import { CheckboxGroup } from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

describe('CheckboxGroup', () => {
  it('should manage selected values and parent mixed state', async () => {
    function PermissionsDemo() {
      const [value, setValue] = useState(['read'])

      return (
        <CheckboxGroup value={value} onValueChange={setValue} allValues={['read', 'write']}>
          <Checkbox parent aria-label="All permissions" />
          <label>
            <Checkbox value="read" />
            Read
          </label>
          <label>
            <Checkbox value="write" />
            Write
          </label>
        </CheckboxGroup>
      )
    }

    const screen = await render(<PermissionsDemo />)
    const parent = screen.getByRole('checkbox', { name: 'All permissions' })
    const write = screen.getByRole('checkbox', { name: 'Write' })

    await expect.element(parent).toHaveAttribute('aria-checked', 'mixed')
    await expect.element(parent).toHaveAttribute('data-indeterminate', '')
    await expect.element(write).toHaveAttribute('aria-checked', 'false')

    asHTMLElement(parent.element()).click()

    await vi.waitFor(async () => {
      await expect.element(parent).toHaveAttribute('aria-checked', 'true')
      await expect.element(write).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('should compose with Base UI Field and Fieldset without losing labels', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <Field.Root name="features">
        <Fieldset.Root render={<CheckboxGroup value={['search']} onValueChange={onValueChange} />}>
          <Fieldset.Legend>Features</Fieldset.Legend>
          <Field.Item>
            <Field.Label>
              <Checkbox value="search" />
              Search
            </Field.Label>
          </Field.Item>
          <Field.Item>
            <Field.Label>
              <Checkbox value="analytics" />
              Analytics
            </Field.Label>
          </Field.Item>
        </Fieldset.Root>
      </Field.Root>,
    )

    const analytics = screen.getByRole('checkbox', { name: 'Analytics' })
    await expect.element(analytics).toHaveAttribute('aria-checked', 'false')

    asHTMLElement(analytics.element()).click()

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange.mock.calls[0]?.[0]).toEqual(['search', 'analytics'])
  })
})
