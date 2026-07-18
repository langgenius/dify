import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderTdValue } from '../utils'

describe('renderTdValue', () => {
  it.each([
    ['test value', 'test value'],
    [42, '42'],
    [0, '0'],
  ])('renders %s as visible table content', (value, expected) => {
    render(<>{renderTdValue(value)}</>)

    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('uses a dash when the value is absent', () => {
    render(<>{renderTdValue(null)}</>)

    expect(screen.getByText('-')).toBeInTheDocument()
  })
})
