import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import SearchBox from '../index'

vi.mock('../tags-filter', () => ({
  default: () => <div>Tag filter</div>,
}))

const SearchHarness = ({ usedInMarketplace }: { usedInMarketplace: boolean }) => {
  const [search, setSearch] = useState('')
  return (
    <SearchBox
      search={search}
      onSearchChange={setSearch}
      tags={[]}
      onTagsChange={vi.fn()}
      placeholder="Search plugins"
      showTags={false}
      usedInMarketplace={usedInMarketplace}
    />
  )
}

describe('SearchBox', () => {
  it.each([true, false])('updates and clears search in marketplace mode %s', async (mode) => {
    const user = userEvent.setup()
    render(<SearchHarness usedInMarketplace={mode} />)

    const input = screen.getByPlaceholderText('Search plugins')
    await user.type(input, 'agent')
    expect(input).toHaveValue('agent')

    await user.click(screen.getByRole('button'))
    expect(input).toHaveValue('')
  })

  it('opens the custom tool flow from the add button', async () => {
    const user = userEvent.setup()
    const onShowAddCustomCollectionModal = vi.fn()

    render(
      <SearchBox
        search=""
        onSearchChange={vi.fn()}
        tags={[]}
        onTagsChange={vi.fn()}
        showTags={false}
        supportAddCustomTool
        onShowAddCustomCollectionModal={onShowAddCustomCollectionModal}
      />,
    )

    await user.click(screen.getByRole('button'))
    expect(onShowAddCustomCollectionModal).toHaveBeenCalledOnce()
  })
})
