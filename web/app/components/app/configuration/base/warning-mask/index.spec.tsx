import React from 'react'
import { render, screen } from '@testing-library/react'
import WarningMask from './index'

describe('WarningMask', () => {
  // Rendering of title, description, and footer content
  describe('Rendering', () => {
    test('should display provided title, description, and footer node', () => {
      const footer = <button type="button">Retry</button>
      // Arrange
      render(
        <WarningMask
          title="Access Restricted"
          description="Only workspace owners may modify this section."
          footer={footer}
        />,
      )

      // Assert
      expect(screen.getByText('Access Restricted')).toBeInTheDocument()
      expect(screen.getByText('Only workspace owners may modify this section.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })
  })
})
