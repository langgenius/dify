import React from 'react'
import { render, screen } from '@testing-library/react'
import Tooltip from './tooltip'

describe('CloudPlanItem/List/Item/Tooltip', () => {
  test('should render tooltip content', () => {
    render(<Tooltip content="Tooltip details" />)
    expect(screen.getByText('Tooltip details')).toBeInTheDocument()
  })
})
