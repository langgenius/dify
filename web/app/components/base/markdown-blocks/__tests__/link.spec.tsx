import type { ReactElement } from 'react'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatContext } from '@/app/components/base/chat/chat/context'
import Link from '../link'

const onSend = vi.fn()
const render = (ui: ReactElement) =>
  rtlRender(<ChatContext.Provider value={{ chatList: [], onSend }}>{ui}</ChatContext.Provider>)

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

it('sends decoded chat actions through the real context when activated by keyboard', async () => {
  const user = userEvent.setup()
  render(
    <Link
      node={{ properties: { href: 'abbr:hello%20world' }, children: [{ value: 'Send greeting' }] }}
    />,
  )
  await user.tab()
  expect(screen.getByRole('button', { name: 'Send greeting' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onSend).toHaveBeenCalledExactlyOnceWith('hello world')
})

it('scrolls to the matching anchor only within its own answer', async () => {
  const user = userEvent.setup()
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
  render(
    <>
      <div className="chat-answer-container">
        <div id="section1">Other answer</div>
      </div>
      <div className="chat-answer-container">
        <div id="section1">Current answer</div>
        <Link node={{ properties: { href: '#section1' } }}>Go</Link>
      </div>
    </>,
  )
  await user.click(screen.getByRole('link', { name: 'Go' }))
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'smooth' })
  expect(scroll.mock.contexts[0]).toBe(screen.getByText('Current answer'))
})

it.each([true, false])(
  'does not scroll when no target belongs to the answer (inside=%s)',
  async (inside) => {
    const user = userEvent.setup()
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    render(
      <div className={inside ? 'chat-answer-container' : undefined}>
        <Link node={{ properties: { href: '#missing' } }}>Missing</Link>
      </div>,
    )
    await user.click(screen.getByRole('link', { name: 'Missing' }))
    expect(scroll).not.toHaveBeenCalled()
  },
)

it.each([undefined, 'not-a-url'])('keeps %s as readable text without a navigable link', (href) => {
  render(<Link node={{ properties: { href } }}>Reference</Link>)
  expect(screen.getByText('Reference')).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})

it('opens external links in an isolated tab', () => {
  render(<Link node={{ properties: { href: 'https://example.com' } }}>Visit</Link>)
  const link = screen.getByRole('link', { name: 'Visit' })
  expect(link).toHaveAttribute('href', 'https://example.com')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

it('adds attachment mode to file-preview links by default', () => {
  const node = {
    properties: {
      href: 'http://localhost:5001/files/123/file-preview?timestamp=1&nonce=2&sign=3',
    },
  }

  render(<Link node={node}>doc.pdf</Link>)

  expect(screen.getByText('doc.pdf')).toHaveAttribute(
    'href',
    'http://localhost:5001/files/123/file-preview?timestamp=1&nonce=2&sign=3&as_attachment=true',
  )
})

it('does not duplicate attachment mode for file-preview links', () => {
  const node = {
    properties: {
      href: 'http://localhost:5001/files/123/file-preview?timestamp=1&nonce=2&sign=3&as_attachment=true',
    },
  }

  render(<Link node={node}>doc.pdf</Link>)

  expect(screen.getByText('doc.pdf')).toHaveAttribute(
    'href',
    'http://localhost:5001/files/123/file-preview?timestamp=1&nonce=2&sign=3&as_attachment=true',
  )
})

it('keeps protocol-relative file-preview links protocol-relative', () => {
  const node = {
    properties: {
      href: '//localhost:5001/files/123/file-preview?timestamp=1#page',
    },
  }

  render(<Link node={node}>doc.pdf</Link>)

  expect(screen.getByText('doc.pdf')).toHaveAttribute(
    'href',
    '//localhost:5001/files/123/file-preview?timestamp=1&as_attachment=true#page',
  )
})
