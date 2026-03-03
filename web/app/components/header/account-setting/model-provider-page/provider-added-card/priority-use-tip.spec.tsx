import { render } from '@testing-library/react'
import PriorityUseTip from './priority-use-tip'

describe('PriorityUseTip', () => {
  it('should render tooltip with icon content', () => {
    const { container } = render(<PriorityUseTip />)
    expect(container.querySelector('[data-state]')).toBeInTheDocument()
  })

  it('should render the component without crashing', () => {
    const { container } = render(<PriorityUseTip />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
