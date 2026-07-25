import { render } from 'vitest-browser-react'
import { Fieldset, FieldsetLegend } from '../index'

describe('Fieldset primitives', () => {
  it('should forward className to the fieldset and legend', async () => {
    const screen = await render(
      <Fieldset className="custom-root">
        <FieldsetLegend className="custom-legend">Permissions</FieldsetLegend>
      </Fieldset>,
    )

    const legend = screen.getByText('Permissions').element() as HTMLElement
    const fieldset = legend.closest('fieldset') as HTMLElement

    await expect.element(fieldset).toHaveClass('custom-root')
    await expect.element(legend).toHaveClass('custom-legend')
  })
})
