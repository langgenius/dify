import React from 'react'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import Loading from './index'

describe('Loading Component', () => {
  it('renders correctly with default props', () => {
    const { container } = render(<Loading />)
    expect(container.firstChild).toHaveClass('flex w-full items-center justify-center')
    expect(container.firstChild).not.toHaveClass('h-full')
  })

  it('renders correctly with area type', () => {
    const { container } = render(<Loading type="area" />)
    expect(container.firstChild).not.toHaveClass('h-full')
  })

  it('renders correctly with app type', () => {
    const { container } = render(<Loading type='app' />)
    expect(container.firstChild).toHaveClass('h-full')
  })

  it('contains SVG with spin-animation class', () => {
    const { container } = render(<Loading />)

    const svgElement = container.querySelector('svg')
    expect(svgElement).toHaveClass('spin-animation')
  })
})
