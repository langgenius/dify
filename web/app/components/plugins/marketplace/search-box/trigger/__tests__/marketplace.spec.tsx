import type { Tag } from '../../../../hooks'
import { Popover } from '@langgenius/dify-ui/popover'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import MarketplaceTrigger from '../marketplace'

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('MarketplaceTrigger', () => {
  it('shows all-tags text when no tags are selected', () => {
    render(
      <Popover>
        <MarketplaceTrigger
          selectedTagsLength={0}
          open={false}
          tags={[]}
          tagsMap={tagsMap}
          onTagsChange={vi.fn()}
        />
      </Popover>,
    )

    expect(screen.getByRole('button', { name: 'pluginTags.allTags' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^pluginTags\.clearSelectedTags/ }),
    ).not.toBeInTheDocument()
  })

  it('shows selected tag labels and overflow count', () => {
    render(
      <Popover>
        <MarketplaceTrigger
          selectedTagsLength={3}
          open
          tags={['agent', 'rag', 'search']}
          tagsMap={tagsMap}
          onTagsChange={vi.fn()}
        />
      </Popover>,
    )

    expect(screen.getByText('Agent,RAG')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent, RAG, Search' })).toBeInTheDocument()
  })

  it('clears selected tags from a separate button', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [tags, setTags] = useState(['agent'])
      return (
        <Popover>
          <MarketplaceTrigger
            selectedTagsLength={tags.length}
            open={false}
            tags={tags}
            tagsMap={tagsMap}
            onTagsChange={setTags}
          />
        </Popover>
      )
    }

    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Agent' })
    const clearButton = screen.getByRole('button', { name: /^pluginTags\.clearSelectedTags/ })
    expect(trigger).not.toContainElement(clearButton)

    await user.click(clearButton)

    expect(
      screen.queryByRole('button', { name: /^pluginTags\.clearSelectedTags/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'pluginTags.allTags' })).toHaveFocus()
  })
})
