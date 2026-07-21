import { render, screen } from '@testing-library/react'
import RoleBadges from '../role-badges'

describe('RoleBadges', () => {
  it('shows the visible roles and summarizes overflow', () => {
    render(<RoleBadges roleNames={['Owner', 'Admin', 'Editor']} max={2} />)

    expect(screen.getByTitle('Owner')).toBeInTheDocument()
    expect(screen.getByTitle('Admin')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.queryByTitle('Editor')).not.toBeInTheDocument()
  })
})
