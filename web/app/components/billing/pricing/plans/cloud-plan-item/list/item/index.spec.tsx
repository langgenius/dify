import React from 'react'
import { render, screen } from '@testing-library/react'
import Item from './index'

describe('CloudPlanItem/List/Item', () => {
  test('should render label text', () => {
    render(<Item label="Unlimited Apps" />)

    expect(screen.getByText('Unlimited Apps')).toBeInTheDocument()
  })

  test('should render tooltip when provided', () => {
    render(<Item label="Requests" tooltip="Explains the limit" />)

    expect(screen.getByText('Explains the limit')).toBeInTheDocument()
  })
})
