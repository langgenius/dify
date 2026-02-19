import type { NamedExoticComponent } from 'react'
import type { ChatContextValue } from '@/app/components/base/chat/chat/context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// markdown-button.spec.tsx
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context'

import MarkdownButton from './button'

// Only mock the URL utility so behavior is deterministic
const isValidUrlSpy = vi.fn()
vi.mock('./utils', () => ({
  isValidUrl: (u: string) => isValidUrlSpy(u),
})) // test subject

type TestNode = {
  properties?: {
    dataVariant?: string
    dataMessage?: string
    dataLink?: string
    dataSize?: string
  }
  children?: Array<{ value?: string }>
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
        <MarkdownButton node={node as unknown as Record<string, unknown>} />
      </ChatContextProvider>,
    )
  }

  it('renders button text from node children', () => {
    const node: TestNode = { children: [{ value: 'Click me' }], properties: {} }
    renderWithCtx(node)
    expect(screen.getByRole('button')).toHaveTextContent('Click me')
  })

  it('opens new tab when link is valid and does not call onSend', async () => {
    isValidUrlSpy.mockReturnValue(true)
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()

    const node: TestNode = {
      properties: { dataLink: 'https://example.com' },
      children: [{ value: 'Go' }],
    }

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

    const node: TestNode = {
      properties: { dataLink: 'not-a-url', dataMessage: 'hello!' },
      children: [{ value: 'Send' }],
    }

    renderWithCtx(node)
    await user.click(screen.getByRole('button'))

    expect(isValidUrlSpy).toHaveBeenCalledWith('not-a-url')
    expect(onSendSpy).toHaveBeenCalledTimes(1)
    expect(onSendSpy).toHaveBeenCalledWith('hello!')
  })

  it('does nothing when no link and no message', async () => {
    isValidUrlSpy.mockReturnValue(false)
    const user = userEvent.setup()

    const node: TestNode = { properties: {}, children: [{ value: 'Empty' }] }
    renderWithCtx(node)
    await user.click(screen.getByRole('button'))

    expect(isValidUrlSpy).not.toHaveBeenCalled()
    expect(onSendSpy).not.toHaveBeenCalled()
  })

  it('calls onSend when message present and no link', async () => {
    const user = userEvent.setup()
    const node: TestNode = {
      properties: { dataMessage: 'msg-only' },
      children: [{ value: 'Msg' }],
    }

    renderWithCtx(node)
    await user.click(screen.getByRole('button'))

    expect(onSendSpy).toHaveBeenCalledWith('msg-only')
  })

  it('has displayName set to MarkdownButton', () => {
    const comp = MarkdownButton as NamedExoticComponent<{ node: unknown }>
    expect(comp.displayName).toBe('MarkdownButton')
  })
})
