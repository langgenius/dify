import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormattedText } from '../formatted'

describe('FormattedText', () => {
  it('should render children', () => {
    render(<FormattedText>Hello World</FormattedText>)
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('should apply leading-7 class by default', () => {
    render(<FormattedText>Text</FormattedText>)
    expect(screen.getByText('Text')).toHaveClass('leading-7')
  })

  it('should merge custom className', () => {
    render(<FormattedText className="custom-class">Text</FormattedText>)
    const el = screen.getByText('Text')
    expect(el).toHaveClass('leading-7')
    expect(el).toHaveClass('custom-class')
  })

  it('should render as a p element', () => {
    render(<FormattedText>Text</FormattedText>)
    expect(screen.getByText('Text').tagName).toBe('P')
  })
})
