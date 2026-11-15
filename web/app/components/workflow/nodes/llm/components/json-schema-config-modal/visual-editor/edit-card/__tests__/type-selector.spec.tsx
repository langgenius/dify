import type { TypeItem } from '../type-selector'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Type } from '../../../../../types'
import TypeSelector from '../type-selector'

it('returns the schema type item selected by its display name', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  const numberItem: TypeItem = { value: Type.number, text: 'Number' }
  render(
    <TypeSelector
      items={[{ value: Type.string, text: 'String' }, numberItem]}
      currentValue={Type.string}
      onSelect={onSelect}
    />,
  )
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: 'Number' }))
  expect(onSelect).toHaveBeenCalledWith(numberItem)
})
