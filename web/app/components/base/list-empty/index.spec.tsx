import { render, screen } from '@testing-library/react'
import * as React from 'react'
import ListEmpty from './index'

describe('ListEmpty Component', () => {
  describe('Render', () => {
    it('renders default icon when no icon is provided', () => {
      const { container } = render(<ListEmpty />)
      expect(container.querySelector('[data-icon="Variable02"]')).toBeInTheDocument()
    })

    it('renders custom icon when provided', () => {
      const { container } = render(<ListEmpty icon={<div data-testid="custom-icon" />} />)
      expect(container.querySelector('[data-icon="Variable02"]')).not.toBeInTheDocument()
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })

    it('renders design lines', () => {
      const { container } = render(<ListEmpty />)
      const svgs = container.querySelectorAll('svg')
      expect(svgs).toHaveLength(5)
    })
  })

  describe('Props', () => {
    it('renders title and description correctly', () => {
      const testTitle = 'Empty List'
      const testDescription = <span data-testid="desc">No items found</span>

      render(<ListEmpty title={testTitle} description={testDescription} />)

      expect(screen.getByText(testTitle)).toBeInTheDocument()
      expect(screen.getByTestId('desc')).toBeInTheDocument()
      expect(screen.getByText('No items found')).toBeInTheDocument()
    })
  })
})
