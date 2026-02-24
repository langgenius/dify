import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import PreCode from './pre-code'

describe('PreCode Component', () => {
  it('renders children correctly inside the pre tag', () => {
    const { container } = render(
      <PreCode>
        <code data-testid="test-code">console.log("hello world")</code>
      </PreCode>,
    )

    const preElement = container.querySelector('pre')
    const codeElement = screen.getByTestId('test-code')

    expect(preElement).toBeInTheDocument()
    expect(codeElement).toBeInTheDocument()
    // Verify code is a descendant of pre
    expect(preElement).toContainElement(codeElement)
    expect(codeElement.textContent).toBe('console.log("hello world")')
  })

  it('contains the copy button span for CSS targeting', () => {
    const { container } = render(
      <PreCode>
        <code>test content</code>
      </PreCode>,
    )

    const copySpan = container.querySelector('.copy-code-button')
    expect(copySpan).toBeInTheDocument()
    expect(copySpan?.tagName).toBe('SPAN')
  })

  it('renders as a <pre> element', () => {
    const { container } = render(<PreCode>Content</PreCode>)
    expect(container.querySelector('pre')).toBeInTheDocument()
  })

  it('handles multiple children correctly', () => {
    render(
      <PreCode>
        <span>Line 1</span>
        <span>Line 2</span>
      </PreCode>,
    )

    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByText('Line 2')).toBeInTheDocument()
  })

  it('correctly instantiates the pre element node', () => {
    const { container } = render(<PreCode>Ref check</PreCode>)
    const pre = container.querySelector('pre')

    // Verifies the node is an actual HTMLPreElement,
    // confirming the ref-linked element rendered correctly.
    expect(pre).toBeInstanceOf(HTMLPreElement)
  })
})
