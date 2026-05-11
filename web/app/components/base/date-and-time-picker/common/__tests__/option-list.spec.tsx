import { render, screen } from '@testing-library/react'
import OptionList from '../option-list'

describe('OptionList', () => {
  it('should render a scrollable list with hidden scrollbar styles', () => {
    render(
      <OptionList>
        <li>Item</li>
      </OptionList>,
    )

    const list = screen.getByRole('list')

    expect(list).toHaveClass('overflow-y-auto')
    expect(list).toHaveClass('[scrollbar-width:none]')
    expect(list).toHaveClass('[&::-webkit-scrollbar]:hidden')
  })

  it('should append caller className after default classes', () => {
    render(
      <OptionList className="custom-list">
        <li>Item</li>
      </OptionList>,
    )

    expect(screen.getByRole('list')).toHaveClass('custom-list')
  })
})
