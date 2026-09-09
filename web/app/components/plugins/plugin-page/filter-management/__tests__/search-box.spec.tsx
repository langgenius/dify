import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

describe('SearchBox', () => {
  let SearchBox: (typeof import('../search-box'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../search-box')
    SearchBox = mod.default
  })

  it('should expose a labeled search box and forward the edited query', async () => {
    const user = userEvent.setup()
    const mockOnChange = vi.fn()
    const TestSearchBox = () => {
      const [query, setQuery] = useState('test query')

      return (
        <SearchBox
          searchQuery={query}
          onChange={(nextQuery) => {
            setQuery(nextQuery)
            mockOnChange(nextQuery)
          }}
        />
      )
    }

    render(<TestSearchBox />)

    const searchBox = screen.getByRole('searchbox', { name: 'plugin.search' })
    expect(searchBox).toHaveAttribute('placeholder', 'plugin.search')
    expect(searchBox).toHaveValue('test query')

    await user.clear(searchBox)
    await user.type(searchBox, 'new query')

    expect(mockOnChange).toHaveBeenCalledWith('new query')
  })
})
