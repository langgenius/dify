import { render, screen } from '@testing-library/react'
import Empty from '../empty'

describe('Empty State', () => {
  describe('Rendering', () => {
    it('should render title without documentation link', () => {
      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('common.apiBasedExtension.title')).toBeInTheDocument()
      expect(screen.queryByText('common.apiBasedExtension.link')).not.toBeInTheDocument()
    })
  })
})
