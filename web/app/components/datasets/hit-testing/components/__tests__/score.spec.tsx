import { render, screen } from '@testing-library/react'
import Score from '../score'

describe('Score', () => {
  it('displays a retrieval score rounded to two decimal places', () => {
    render(<Score value={0.678} />)

    expect(screen.getByText('0.68')).toBeInTheDocument()
  })

  it.each([null, 0, Number.NaN])('does not display an absent score for %s', (value) => {
    const { container } = render(<Score value={value} />)

    expect(container).toBeEmptyDOMElement()
  })
})
