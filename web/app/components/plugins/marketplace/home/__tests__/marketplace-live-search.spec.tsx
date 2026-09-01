import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarketplaceLiveSearch from '../marketplace-live-search'

const { mockReplace } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
}))

vi.mock('ahooks', async (importOriginal) => {
  const original = await importOriginal<typeof import('ahooks')>()

  return {
    ...original,
    useDebounce: <T,>(value: T) => value,
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

describe('MarketplaceLiveSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates the active tab result route while the user types', async () => {
    const user = userEvent.setup()

    render(
      <MarketplaceLiveSearch
        action="/templates/knowledge"
        language="en-US"
        placeholder="Search templates"
        query=""
      />,
    )

    await user.type(screen.getByRole('searchbox'), 'legal')

    await waitFor(() => {
      expect(mockReplace).toHaveBeenLastCalledWith('/templates/knowledge?q=legal&language=en-US', {
        scroll: false,
      })
    })
  })

  it('clears the query without leaving the active plugin tab', async () => {
    const user = userEvent.setup()

    render(
      <MarketplaceLiveSearch action="/plugins/tool" placeholder="Search plugins" query="maps" />,
    )

    await user.clear(screen.getByRole('searchbox'))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenLastCalledWith('/plugins/tool', { scroll: false })
    })
  })

  it('preserves catalog filter params while the user types', async () => {
    const user = userEvent.setup()

    render(
      <MarketplaceLiveSearch
        action="/templates/knowledge"
        placeholder="Search templates"
        query=""
        preserveParams={{ languages: ['ja'] }}
      />,
    )

    await user.type(screen.getByRole('searchbox'), 'legal')

    await waitFor(() => {
      expect(mockReplace).toHaveBeenLastCalledWith('/templates/knowledge?q=legal&languages=ja', {
        scroll: false,
      })
    })
  })
})
