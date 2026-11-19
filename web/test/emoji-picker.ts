import type { RenderOptions } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import data from '@/public/emoji/emojibase-17.0.0/en/data.json'
import messages from '@/public/emoji/emojibase-17.0.0/en/messages.json'

const clients: QueryClient[] = []
export function renderWithEmoji(ui: ReactNode, options: RenderOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const Wrapper = options.wrapper
  return render(ui, {
    ...options,
    wrapper: ({ children }) =>
      createElement(
        QueryClientProvider,
        { client },
        Wrapper ? createElement(Wrapper, null, children) : children,
      ),
  })
}

/** Exercise the same catalog used in production at the network boundary. */
export function mockEmojiData() {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (!/^\/.*emoji\/emojibase-17\.0\.0\/en\/(?:data|messages)\.json$/.test(url))
        throw new Error(`Unexpected emoji data URL: ${url}`)
      return new Response(JSON.stringify(url.endsWith('/messages.json') ? messages : data))
    })
  })
  afterEach(() => {
    clients.splice(0).forEach((client) => client.clear())
    vi.restoreAllMocks()
  })
}
