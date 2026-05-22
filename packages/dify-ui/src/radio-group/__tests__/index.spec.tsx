import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { FieldItem, FieldLabel, FieldRoot } from '../../field'
import { FieldsetLegend, FieldsetRoot } from '../../fieldset'
import { Radio } from '../../radio'
import { RadioGroup } from '../index'

const clickElement = (element: HTMLElement | SVGElement) => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('RadioGroup', () => {
  it('should manage a controlled single selection', async () => {
    function StorageDemo() {
      const [value, setValue] = useState('ssd')

      return (
        <FieldRoot name="storageType">
          <FieldsetRoot render={<RadioGroup value={value} onValueChange={setValue} />}>
            <FieldsetLegend>Storage type</FieldsetLegend>
            <FieldItem>
              <FieldLabel>
                <Radio value="ssd" />
                SSD
              </FieldLabel>
            </FieldItem>
            <FieldItem>
              <FieldLabel>
                <Radio value="hdd" />
                HDD
              </FieldLabel>
            </FieldItem>
          </FieldsetRoot>
        </FieldRoot>
      )
    }

    const screen = await render(<StorageDemo />)

    await expect.element(screen.getByRole('radio', { name: 'SSD' })).toHaveAttribute('aria-checked', 'true')

    clickElement(screen.getByRole('radio', { name: 'HDD' }).element())

    await vi.waitFor(async () => {
      await expect.element(screen.getByRole('radio', { name: 'SSD' })).toHaveAttribute('aria-checked', 'false')
      await expect.element(screen.getByRole('radio', { name: 'HDD' })).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('should compose with Dify UI Field and Fieldset without losing labels', async () => {
    const onValueChange = vi.fn()
    const screen = await render(
      <FieldRoot name="storageType">
        <FieldsetRoot render={<RadioGroup value="ssd" onValueChange={onValueChange} />}>
          <FieldsetLegend>Storage type</FieldsetLegend>
          <FieldItem>
            <FieldLabel>
              <Radio value="ssd" />
              SSD
            </FieldLabel>
          </FieldItem>
          <FieldItem>
            <FieldLabel>
              <Radio value="hdd" />
              HDD
            </FieldLabel>
          </FieldItem>
        </FieldsetRoot>
      </FieldRoot>,
    )

    await expect.element(screen.getByRole('radiogroup', { name: 'Storage type' })).toBeInTheDocument()

    const hdd = screen.getByRole('radio', { name: 'HDD' })
    await expect.element(hdd).toHaveAttribute('aria-checked', 'false')

    clickElement(hdd.element())

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange.mock.calls[0]?.[0]).toBe('hdd')
  })
})
