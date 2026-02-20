import { render, screen } from '@testing-library/react'
import Empty from './empty'

describe('Empty State', () => {
  describe('Rendering', () => {
    it('should render title and documentation link', () => {
      // Act
      render(<Empty />)

      // Assert
      expect(screen.getByText('common.apiBasedExtension.title')).toBeInTheDocument()
      const link = screen.getByText('common.apiBasedExtension.link')
      expect(link).toBeInTheDocument()
      // The real useDocLink includes the language prefix (defaulting to /en in tests)
      expect(link.closest('a')).toHaveAttribute('href', 'https://docs.dify.ai/en/use-dify/workspace/api-extension/api-extension')
    })
  })
})
