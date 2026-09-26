import { render, screen } from '@testing-library/react'
import { PlanBadge } from '../index'

describe('PlanBadge', () => {
  it('should render sandbox plan', () => {
    render(<PlanBadge plan="sandbox" />)

    expect(screen.getByText('sandbox')).toBeInTheDocument()
  })

  it('should render professional badge when plan is professional', () => {
    render(<PlanBadge plan="professional" />)
    expect(screen.getByText('pro')).toBeInTheDocument()
  })

  it('should render team badge when plan is team', () => {
    render(<PlanBadge plan="team" />)
    expect(screen.getByText('team')).toBeInTheDocument()
  })
})
