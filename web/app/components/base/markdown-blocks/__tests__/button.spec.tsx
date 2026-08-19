import type { ExtraProps } from 'streamdown'
import type { ChatContextValue } from '@/app/components/base/chat/chat/context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// markdown-button.spec.tsx
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context-provider'
import MarkdownButton from '../button'

// Only mock the URL utility so behavior is deterministic
const isValidUrlSpy = vi.fn()
vi.mock('../utils', () => ({
  isValidUrl: (u: string) => isValidUrlSpy(u),
})) // test subject

type TestNode = NonNullable<ExtraProps['node']>

function createButtonNode(properties: TestNode['properties'], label?: string): TestNode {
  return {
    type: 'element',
    tagName: 'button',
    properties,
    children: label === undefined ? [] : [{ type: 'text', value: label }],
  }
}

describe('MarkdownButton (integration)', () => {
  const onSendSpy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderWithCtx(node: TestNode) {
    // Provide minimal ChatContext; cast to ChatContextValue to satisfy the provider signature
    const ctx = {
      onSend: (msg: unknown) => onSendSpy(msg),
      // other props are optional at runtime; assert type to satisfy TS
    } as unknown as ChatContextValue

    return render(
      <ChatContextProvider {...ctx}>
        <MarkdownButton node={node} />
      </ChatContextProvider>,
    )
  }

  it('renders button text from node children', () => {
    const node = createButtonNode({}, 'Click me')
    renderWithCtx(node)
    expect(screen.getByRole('button')).toHaveTextContent('Click me')
  })

  it('opens new tab when link is valid and does not call onSend', async () => {
    isValidUrlSpy.mockReturnValue(true)
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()

    const node = createButtonNode({ dataLink: 'https://example.com' }, 'Go')

    renderWithCtx(node)
    await user.click(screen.getByRole('button'))

    expect(isValidUrlSpy).toHaveBeenCalledWith('https://example.com')
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank')
    expect(onSendSpy).not.toHaveBeenCalled()

    openSpy.mockRestore()
  })

  it('calls onSend when link is invalid but message exists', async () => {
    isValidUrlSpy.mockReturnValue(false)
    const user = userEvent.setup()

    const node = createButtonNode({ dataLink: 'not-a-url', dataMessage: 'hello!' }, 'Send')

    renderWithCtx(node)
    await user.click(screen.getByRole('button'))

    expect(isValidUrlSpy).toHaveBeenCalledWith('not-a-url')
    expect(onSendSpy).toHaveBeenCalledTimes(1)
    expect(onSendSpy).toHaveBeenCalledWith('hello!')
  })

  it('does nothing when no link and no message', async () => {
    isValidUrlSpy.mockReturnValue(false)
    const user = userEvent.setup()

    const node = createButtonNode({}, 'Empty')
    renderWithCtx(node)
    await user.click(screen.getByRole('button'))

    expect(isValidUrlSpy).not.toHaveBeenCalled()
    expect(onSendSpy).not.toHaveBeenCalled()
  })

  it('calls onSend when message present and no link', async () => {
    const user = userEvent.setup()
    const node = createButtonNode({ dataMessage: 'msg-only' }, 'Msg')

    renderWithCtx(node)
    await user.click(screen.getByRole('button'))

    expect(onSendSpy).toHaveBeenCalledWith('msg-only')
  })

  it('falls back to empty label when first child value is missing', () => {
    const node = createButtonNode({})
    renderWithCtx(node)

    expect(screen.getByRole('button')).toHaveTextContent('')
  })

  it('maps the legacy warning variant to a destructive primary button', () => {
    renderWithCtx(createButtonNode({ dataVariant: 'warning' }, 'Delete'))

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(
      'bg-components-button-destructive-primary-bg',
    )
  })
})
