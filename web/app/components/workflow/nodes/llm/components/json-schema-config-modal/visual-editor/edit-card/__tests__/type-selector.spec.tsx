import type { TypeItem } from '../type-selector'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Type } from '../../../../../types'
import TypeSelector from '../type-selector'

const items: TypeItem[] = [
  { value: Type.string, text: 'String' },
  { value: Type.number, text: 'Number' },
]

function StatefulTypeSelector() {
  const [currentValue, setCurrentValue] = useState<Type>(Type.string)
  return (
    <TypeSelector
      items={items}
      currentValue={currentValue}
      onSelect={(item) => setCurrentValue(item.value as Type)}
    />
  )
}

describe('TypeSelector', () => {
  it('renders the check from Select item state and updates it after selection', async () => {
    const user = userEvent.setup()
    render(<StatefulTypeSelector />)

    await user.click(screen.getByRole('combobox'))

    const stringOption = screen.getByRole('option', { name: 'String' })
    const numberOption = screen.getByRole('option', { name: 'Number' })
    expect(stringOption).toHaveAttribute('data-selected')
    expect(stringOption.querySelector('svg')).toBeInTheDocument()
    expect(numberOption).not.toHaveAttribute('data-selected')
    expect(numberOption.querySelector('svg')).not.toBeInTheDocument()

    await user.click(numberOption)
    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: 'String' })).not.toHaveAttribute('data-selected')
    expect(screen.getByRole('option', { name: 'Number' })).toHaveAttribute('data-selected')
    expect(screen.getByRole('option', { name: 'Number' }).querySelector('svg')).toBeInTheDocument()
  })
})
