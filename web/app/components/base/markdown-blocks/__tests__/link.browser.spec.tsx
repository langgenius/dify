import type { ReactElement } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render as browserRender } from 'vitest-browser-react'
import { ChatContext } from '@/app/components/base/chat/chat/context'
import Link from '../link'

const onSend = vi.fn()
const render = (ui: ReactElement) =>
  browserRender(
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its custom Provider.
    <ChatContext.Provider value={{ chatList: [], onSend }}>{ui}</ChatContext.Provider>,
  )

beforeEach(() => onSend.mockReset())

it('sends decoded chat actions from the native keyboard focus order', async () => {
  const screen = await render(
    <Link
      node={{ properties: { href: 'abbr:hello%20world' }, children: [{ value: 'Send greeting' }] }}
    />,
  )

  await userEvent.keyboard('{Tab}')
  const action = screen.getByRole('button', { name: 'Send greeting' })
  await expect.element(action).toHaveFocus()
  await userEvent.keyboard('{Enter}')

  expect(onSend).toHaveBeenCalledExactlyOnceWith('hello world')
})

it('scrolls only the matching anchor inside the current answer', async () => {
  await page.viewport(800, 600)
  const screen = await render(
    <div>
      <section
        aria-label="Other answer container"
        className="chat-answer-container"
        style={{ height: 80, overflow: 'auto' }}
      >
        <div style={{ height: 280 }} />
        <div id="section1">Other answer</div>
      </section>
      <section
        aria-label="Current answer container"
        className="chat-answer-container"
        style={{ height: 80, overflow: 'auto' }}
      >
        <Link node={{ properties: { href: '#section1' } }}>Go to current section</Link>
        <div style={{ height: 280 }} />
        <div id="section1">Current answer</div>
      </section>
    </div>,
  )

  const otherAnswer = screen.getByRole('region', { name: 'Other answer container' })
  const currentAnswer = screen.getByRole('region', { name: 'Current answer container' })
  await expect.element(otherAnswer).toBeVisible()
  await expect.element(currentAnswer).toBeVisible()
  await screen.getByRole('link', { name: 'Go to current section' }).click()

  await expect.poll(() => currentAnswer.element().scrollTop).toBeGreaterThan(0)
  expect(otherAnswer.element().scrollTop).toBe(0)
  await expect.element(screen.getByText('Current answer')).toBeVisible()
})

it('keeps invalid destinations as readable text and isolates external navigation', async () => {
  const screen = await render(
    <div>
      <Link node={{ properties: { href: 'not-a-url' } }}>Reference</Link>
      <Link node={{ properties: { href: 'https://example.com' } }}>Visit Dify example</Link>
    </div>,
  )

  await expect.element(screen.getByText('Reference')).toBeVisible()
  await expect.element(screen.getByRole('link', { name: 'Reference' })).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('link', { name: 'Visit Dify example' }))
    .toHaveAttribute('href', 'https://example.com')
  await expect
    .element(screen.getByRole('link', { name: 'Visit Dify example' }))
    .toHaveAttribute('target', '_blank')
  await expect
    .element(screen.getByRole('link', { name: 'Visit Dify example' }))
    .toHaveAttribute('rel', 'noopener noreferrer')
})

it('adds attachment mode once while preserving file-preview URL shape', async () => {
  const screen = await render(
    <div>
      <Link
        node={{
          properties: {
            href: 'http://localhost:5001/files/123/file-preview?timestamp=1&nonce=2&sign=3',
          },
        }}
      >
        New attachment
      </Link>
      <Link
        node={{
          properties: {
            href: 'http://localhost:5001/files/123/file-preview?timestamp=1&as_attachment=true',
          },
        }}
      >
        Existing attachment
      </Link>
      <Link
        node={{
          properties: { href: '//localhost:5001/files/123/file-preview?timestamp=1#page' },
        }}
      >
        Protocol-relative attachment
      </Link>
    </div>,
  )

  await expect
    .element(screen.getByRole('link', { name: 'New attachment' }))
    .toHaveAttribute(
      'href',
      'http://localhost:5001/files/123/file-preview?timestamp=1&nonce=2&sign=3&as_attachment=true',
    )
  await expect
    .element(screen.getByRole('link', { name: 'Existing attachment' }))
    .toHaveAttribute(
      'href',
      'http://localhost:5001/files/123/file-preview?timestamp=1&as_attachment=true',
    )
  await expect
    .element(screen.getByRole('link', { name: 'Protocol-relative attachment' }))
    .toHaveAttribute(
      'href',
      '//localhost:5001/files/123/file-preview?timestamp=1&as_attachment=true#page',
    )
})
