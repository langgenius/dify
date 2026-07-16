import { render, screen } from '@testing-library/react'
import RoleBadges from '../role-badges'

describe('RoleBadges', () => {
  describe('Rendering', () => {
    it('should expose visible role names as badge titles', () => {
      render(<RoleBadges roleNames={['Very long custom role name', 'Admin']} />)

      expect(screen.getByTitle('Very long custom role name'))!.toHaveTextContent(
        'Very long custom role name',
      )
      expect(screen.getByTitle('Admin'))!.toHaveTextContent('Admin')
    })

    it('should render overflow count for hidden roles', () => {
      render(<RoleBadges roleNames={['Owner', 'Admin', 'Editor']} max={2} />)

      expect(screen.getByTitle('Owner'))!.toBeInTheDocument()
      expect(screen.getByTitle('Admin'))!.toBeInTheDocument()
      expect(screen.getByText('+1'))!.toBeInTheDocument()
      expect(screen.queryByTitle('Editor')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should keep the wrapper rendered when role names are empty', () => {
      const { container } = render(<RoleBadges roleNames={[]} className="role-badges-empty" />)

      const wrapper = container.querySelector('.role-badges-empty')
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toBeEmptyDOMElement()
    })
  })
})
