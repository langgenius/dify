import { render, screen } from '@testing-library/react'
import * as React from 'react'
import EmptyElement from './empty-element'

describe('EmptyElement', () => {
  it('should render the empty state copy and supporting icon', () => {
    const { container } = render(<EmptyElement />)

    expect(screen.getByText('appAnnotation.noData.title')).toBeInTheDocument()
    expect(screen.getByText('appAnnotation.noData.description')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
