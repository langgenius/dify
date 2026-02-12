import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ApiIndex from '../index'

afterEach(() => {
  cleanup()
})

describe('ApiIndex', () => {
  it('should render without crashing', () => {
    render(<ApiIndex />)
    expect(screen.getByText('index')).toBeInTheDocument()
  })

  it('should render a div with text "index"', () => {
    const { container } = render(<ApiIndex />)
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement)
    expect(container.textContent).toBe('index')
  })

  it('should be a valid function component', () => {
    expect(typeof ApiIndex).toBe('function')
  })
})
