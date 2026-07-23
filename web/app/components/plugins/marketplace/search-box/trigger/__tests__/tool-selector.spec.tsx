import type { Tag } from '../../../../hooks'
import { Popover, PopoverContent } from '@langgenius/dify-ui/popover'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import ToolSelectorTrigger from '../tool-selector'

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('ToolSelectorTrigger', () => {
  it('renders only icon when no tags are selected', () => {
    render(
      <Popover>
        <ToolSelectorTrigger
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
    expect(screen.queryByText('Agent')).not.toBeInTheDocument()
  })

  it('renders selected tag labels and overflow count', () => {
    render(
      <Popover>
        <ToolSelectorTrigger
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
    expect(
      screen.getByRole('button', { name: /^pluginTags\.clearSelectedTags/ }),
    ).toBeInTheDocument()
  })

  it('opens the tag filter from the keyboard', async () => {
    const user = userEvent.setup()

    render(
      <Popover>
        <ToolSelectorTrigger
          selectedTagsLength={0}
          open={false}
          tags={[]}
          tagsMap={tagsMap}
          onTagsChange={vi.fn()}
        />
        <PopoverContent>Tag options</PopoverContent>
      </Popover>,
    )

    const trigger = screen.getByRole('button', { name: 'pluginTags.allTags' })
    await user.tab()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.getByText('Tag options')).toBeInTheDocument()
  })

  it('keeps clear as a separate action from the popover trigger', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [tags, setTags] = useState(['agent'])
      return (
        <Popover>
          <ToolSelectorTrigger
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
    trigger.focus()
    await user.tab()
    expect(clearButton).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(
      screen.queryByRole('button', { name: /^pluginTags\.clearSelectedTags/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'pluginTags.allTags' })).toHaveFocus()
  })
})
