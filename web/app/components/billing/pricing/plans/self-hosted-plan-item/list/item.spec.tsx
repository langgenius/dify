import { render, screen } from '@testing-library/react'
import * as React from 'react'
import Item from './item'

describe('SelfHostedPlanItem/List/Item', () => {
  it('should display provided feature label', () => {
    const { container } = render(<Item label="Dedicated support" />)

    expect(screen.getByText('Dedicated support')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
