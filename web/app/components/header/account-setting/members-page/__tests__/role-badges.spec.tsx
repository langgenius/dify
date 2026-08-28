import { render, screen } from '@testing-library/react'
import RoleBadges from '../role-badges'

describe('RoleBadges', () => {
  it('shows the visible roles and summarizes overflow', () => {
    render(<RoleBadges roleNames={['Owner', 'Admin', 'Editor']} max={2} />)

    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.queryByText('Editor')).not.toBeInTheDocument()
  })
})
