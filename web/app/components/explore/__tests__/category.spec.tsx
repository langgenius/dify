import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Category from '../category'

const props = {
  list: ['Writing', 'Recommended'],
  value: 'Recommended',
  onChange: vi.fn(),
  allCategoriesEn: 'Recommended',
}

describe('Category', () => {
  it('selects a category and returns to the single all-categories option', async () => {
    const user = userEvent.setup()
    function Categories() {
      const [value, setValue] = useState('Recommended')
      return <Category {...props} value={value} onChange={setValue} />
    }
    render(<Categories />)
    const categories = within(screen.getByRole('radiogroup', { name: 'explore.tryApp.category' }))
    const all = categories.getByRole('radio', { name: 'explore.apps.allCategories' })
    const writing = categories.getByRole('radio', { name: 'explore.category.Writing' })
    expect(categories.getAllByRole('radio')).toHaveLength(2)
    expect(all).toHaveAttribute('aria-checked', 'true')

    await user.click(writing)
    expect(writing).toHaveAttribute('aria-checked', 'true')
    expect(all).toHaveAttribute('aria-checked', 'false')
    await user.click(all)
    expect(all).toHaveAttribute('aria-checked', 'true')
    expect(writing).toHaveAttribute('aria-checked', 'false')
  })

  it('falls back to all categories when the selected category is absent', () => {
    render(<Category {...props} value="Unknown" />)
    expect(screen.getByRole('radio', { name: 'explore.apps.allCategories' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('uses the raw name and value for untranslated categories', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Category {...props} list={['CustomCategory']} onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: 'CustomCategory' }))
    expect(onChange).toHaveBeenCalledWith('CustomCategory')
  })
})
