import { render } from 'vitest-browser-react'
import {
  FieldsetLegend,
  FieldsetRoot,
} from '../index'

describe('Fieldset primitives', () => {
  it('should apply reset design-system classes', async () => {
    const screen = await render(
      <FieldsetRoot className="custom-root">
        <FieldsetLegend className="custom-legend">Permissions</FieldsetLegend>
      </FieldsetRoot>,
    )

    const legend = screen.getByText('Permissions').element() as HTMLElement
    const fieldset = legend.closest('fieldset') as HTMLElement

    await expect.element(fieldset).toHaveClass('m-0', 'min-w-0', 'border-0', 'p-0', 'custom-root')
    await expect.element(legend).toHaveClass('mb-1', 'py-1', 'system-sm-medium', 'text-text-secondary', 'custom-legend')
  })
})
