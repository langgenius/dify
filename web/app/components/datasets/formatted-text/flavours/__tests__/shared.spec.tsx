import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SliceContainer, SliceContent, SliceDivider, SliceLabel } from '../shared'

describe('SliceContainer', () => {
  it('should render children', () => {
    render(<SliceContainer>content</SliceContainer>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('should be a span element', () => {
    render(<SliceContainer>text</SliceContainer>)
    expect(screen.getByText('text').tagName).toBe('SPAN')
  })

  it('should merge custom className', () => {
    render(<SliceContainer className="custom">text</SliceContainer>)
    expect(screen.getByText('text')).toHaveClass('custom')
  })

  it('should have display name', () => {
    expect(SliceContainer.displayName).toBe('SliceContainer')
  })
})

describe('SliceLabel', () => {
  it('should render children with uppercase text', () => {
    render(<SliceLabel>Label</SliceLabel>)
    expect(screen.getByText('Label')).toBeInTheDocument()
  })

  it('should apply label styling', () => {
    render(<SliceLabel>Label</SliceLabel>)
    const outer = screen.getByText('Label').parentElement!
    expect(outer).toHaveClass('uppercase')
  })

  it('should apply labelInnerClassName to inner span', () => {
    render(<SliceLabel labelInnerClassName="inner-class">Label</SliceLabel>)
    expect(screen.getByText('Label')).toHaveClass('inner-class')
  })

  it('should have display name', () => {
    expect(SliceLabel.displayName).toBe('SliceLabel')
  })
})

describe('SliceContent', () => {
  it('should render children', () => {
    render(<SliceContent>Content</SliceContent>)
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('should apply whitespace-pre-line and break-all', () => {
    render(<SliceContent>Content</SliceContent>)
    const el = screen.getByText('Content')
    expect(el).toHaveClass('whitespace-pre-line')
    expect(el).toHaveClass('break-all')
  })

  it('should have display name', () => {
    expect(SliceContent.displayName).toBe('SliceContent')
  })
})

describe('SliceDivider', () => {
  it('should render as span', () => {
    const { container } = render(<SliceDivider />)
    expect(container.querySelector('span')).toBeInTheDocument()
  })

  it('should contain zero-width space', () => {
    const { container } = render(<SliceDivider />)
    expect(container.textContent).toContain('\u200B')
  })

  it('should merge custom className', () => {
    const { container } = render(<SliceDivider className="custom" />)
    expect(container.querySelector('span')).toHaveClass('custom')
  })

  it('should have display name', () => {
    expect(SliceDivider.displayName).toBe('SliceDivider')
  })
})
