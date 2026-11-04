import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import MarketplaceDetailDialogFrame from '../frame'

const title = 'Plugin details'
const src = 'about:blank?plugin=first'
const closeName = 'common.operation.close'
const previewMessage = { type: 'dify-marketplace:image-preview', open: true }

const getFrame = () => screen.getByTitle(title) as HTMLIFrameElement

function sendMessage(data: unknown, options?: MessageEventInit) {
  fireEvent(
    window,
    new MessageEvent('message', {
      data,
      origin: 'null',
      source: getFrame().contentWindow,
      ...options,
    }),
  )
}

describe('MarketplaceDetailDialogFrame image preview', () => {
  it('lets the preview own closing until it closes, even without another message handler', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <MarketplaceDetailDialogFrame open src={src} title={title} onOpenChange={onOpenChange} />,
    )

    fireEvent.load(getFrame())
    sendMessage(previewMessage)

    expect(screen.queryByRole('button', { name: closeName })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    sendMessage({ ...previewMessage, open: false })
    await user.click(screen.getByRole('button', { name: closeName }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('accepts preview updates only from this iframe and its expected origin', () => {
    render(<MarketplaceDetailDialogFrame open src={src} title={title} onOpenChange={vi.fn()} />)

    sendMessage(previewMessage, { origin: 'https://another-marketplace.example' })
    expect(screen.getByRole('button', { name: closeName })).toBeInTheDocument()

    sendMessage(previewMessage, { source: window })
    expect(screen.getByRole('button', { name: closeName })).toBeInTheDocument()

    sendMessage(previewMessage)
    expect(screen.queryByRole('button', { name: closeName })).not.toBeInTheDocument()

    sendMessage({ ...previewMessage, open: false }, { source: window })
    expect(screen.queryByRole('button', { name: closeName })).not.toBeInTheDocument()
  })

  it.each([
    null,
    'dify-marketplace:image-preview',
    { type: 'dify-marketplace:image-preview' },
    { type: 'dify-marketplace:image-preview', open: 'true' },
    { type: 'dify-marketplace:image-preview', open: 1 },
    { type: 'dify-marketplace:another-message', open: true },
  ])('ignores malformed or unrelated preview data: %j', (data) => {
    render(<MarketplaceDetailDialogFrame open src={src} title={title} onOpenChange={vi.fn()} />)

    sendMessage(data)
    expect(screen.getByRole('button', { name: closeName })).toBeInTheDocument()
  })

  it('continues forwarding other trusted marketplace messages and replies', () => {
    const request = {
      type: 'dify-marketplace:install-plugin',
      pluginUniqueIdentifier: 'test/plugin:1',
    }
    const response = { type: 'dify-marketplace:install-plugin-status', status: 'success' }
    const onMessage = vi.fn((_data, reply) => reply(response))
    render(
      <MarketplaceDetailDialogFrame
        open
        src={src}
        title={title}
        onMessage={onMessage}
        onOpenChange={vi.fn()}
      />,
    )
    const postMessage = vi.spyOn(getFrame().contentWindow!, 'postMessage')

    sendMessage(request)

    expect(onMessage).toHaveBeenCalledWith(request, expect.any(Function))
    expect(postMessage).toHaveBeenCalledWith(response, 'null')
  })

  it('keeps an active preview above the close button when the iframe load arrives after fallback reveal', async () => {
    vi.useFakeTimers()
    try {
      render(<MarketplaceDetailDialogFrame open src={src} title={title} onOpenChange={vi.fn()} />)
      await act(() => vi.advanceTimersByTimeAsync(15_000))
      expect(getFrame()).not.toHaveAttribute('inert')

      sendMessage(previewMessage)
      expect(screen.queryByRole('button', { name: closeName })).not.toBeInTheDocument()

      fireEvent.load(getFrame())

      expect(screen.queryByRole('button', { name: closeName })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts another detail URL with its own close button', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <MarketplaceDetailDialogFrame open src={src} title={title} onOpenChange={onOpenChange} />,
    )
    sendMessage(previewMessage)
    expect(screen.queryByRole('button', { name: closeName })).not.toBeInTheDocument()

    rerender(
      <MarketplaceDetailDialogFrame
        open
        src="about:blank?plugin=second"
        title={title}
        onOpenChange={onOpenChange}
      />,
    )

    expect(screen.getByRole('button', { name: closeName })).toBeInTheDocument()
  })

  it('restores the close button after the controlled details dialog closes and reopens', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <MarketplaceDetailDialogFrame open src={src} title={title} onOpenChange={onOpenChange} />,
    )
    sendMessage(previewMessage)
    expect(screen.queryByRole('button', { name: closeName })).not.toBeInTheDocument()

    rerender(
      <MarketplaceDetailDialogFrame
        open={false}
        src={src}
        title={title}
        onOpenChange={onOpenChange}
      />,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(
      <MarketplaceDetailDialogFrame open src={src} title={title} onOpenChange={onOpenChange} />,
    )

    expect(screen.getByRole('button', { name: closeName })).toBeInTheDocument()
  })
})
