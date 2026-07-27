import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
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

    const input = screen.getByRole('searchbox', { name: 'Search plugins' })
    await user.type(input, 'agent')
    expect(input).toHaveValue('agent')

    await user.tab()
    const clearButton = screen.getByRole('button', {
      name: /^plugin\.clearSearch/,
    })
    expect(clearButton).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
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

    const addButton = screen.getByRole('button', { name: 'tools.addToolModal.custom.tip' })
    addButton.focus()
    await user.keyboard('{Enter}')
    expect(onShowAddCustomCollectionModal).toHaveBeenCalledOnce()
  })

  it('exposes the input element through its ref', () => {
    const ref = createRef<HTMLInputElement>()

    render(
      <SearchBox
        ref={ref}
        search=""
        onSearchChange={vi.fn()}
        tags={[]}
        onTagsChange={vi.fn()}
        placeholder="Search plugins"
        showTags={false}
      />,
    )

    expect(ref.current).toBe(screen.getByRole('searchbox', { name: 'Search plugins' }))
  })
})
