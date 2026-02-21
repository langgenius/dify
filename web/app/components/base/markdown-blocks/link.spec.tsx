import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Link from './link'

// ---- mocks ----
const mockOnSend = vi.fn()

vi.mock('@/app/components/base/chat/chat/context', () => ({
  useChatContext: () => ({
    onSend: mockOnSend,
  }),
}))

const mockIsValidUrl = vi.fn()
vi.mock('./utils', () => ({
  isValidUrl: (url: string) => mockIsValidUrl(url),
}))

describe('Link component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------
  // ABBR LINK
  // --------------------------
  it('renders abbr link and calls onSend when clicked', () => {
    const node = {
      properties: {
        href: 'abbr:hello%20world',
      },
      children: [{ value: 'Tooltip text' }],
    }

    render(<Link node={node} />)

    const abbr = screen.getByText('Tooltip text')
    expect(abbr.tagName).toBe('ABBR')

    fireEvent.click(abbr)

    expect(mockOnSend).toHaveBeenCalledWith('hello world')
  })

  // --------------------------
  // HASH SCROLL LINK
  // --------------------------
  it('scrolls to target element when hash link clicked', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    const node = {
      properties: {
        href: '#section1',
      },
    }

    const container = document.createElement('div')
    container.className = 'chat-answer-container'

    const target = document.createElement('div')
    target.id = 'section1'

    container.appendChild(target)
    document.body.appendChild(container)

    render(
      <div className="chat-answer-container">
        <div id="section1" />
        <Link node={node}>Go</Link>
      </div>,
    )

    const link = screen.getByText('Go')

    fireEvent.click(link)

    expect(scrollIntoView).toHaveBeenCalled()
  })

  // --------------------------
  // INVALID URL
  // --------------------------
  it('renders span when url is invalid', () => {
    mockIsValidUrl.mockReturnValue(false)

    const node = {
      properties: {
        href: 'not-a-url',
      },
    }

    render(<Link node={node}>Invalid</Link>)

    const span = screen.getByText('Invalid')
    expect(span.tagName).toBe('SPAN')
  })

  // --------------------------
  // VALID EXTERNAL URL
  // --------------------------
  it('renders external link with target blank when url is valid', () => {
    mockIsValidUrl.mockReturnValue(true)

    const node = {
      properties: {
        href: 'https://example.com',
      },
    }

    render(<Link node={node}>Visit</Link>)

    const link = screen.getByText('Visit')

    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  // --------------------------
  // NO HREF
  // --------------------------
  it('renders span when no href provided', () => {
    const node = {
      properties: {},
    }

    render(<Link node={node}>NoHref</Link>)

    const span = screen.getByText('NoHref')
    expect(span.tagName).toBe('SPAN')
  })

  // --------------------------
  // DEFAULT TEXT FALLBACK
  // --------------------------
  it('renders default text for external link if children not provided', () => {
    mockIsValidUrl.mockReturnValue(true)

    const node = {
      properties: {
        href: 'https://example.com',
      },
    }

    render(<Link node={node} />)

    expect(screen.getByText('Download')).toBeInTheDocument()
  })

  it('renders default text for hash link if children not provided', () => {
    const node = {
      properties: {
        href: '#section1',
      },
    }

    render(<Link node={node} />)

    expect(screen.getByText('ScrollView')).toBeInTheDocument()
  })
})
