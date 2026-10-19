import type { Tag } from '../../hooks'
import { Popover } from '@langgenius/dify-ui/popover'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import CompactTrigger from '../compact-trigger'

const tagsMap: Record<string, Tag> = {
  agent: { name: 'agent', label: 'Agent' },
  rag: { name: 'rag', label: 'RAG' },
  search: { name: 'search', label: 'Search' },
}

describe('CompactTrigger', () => {
  it('renders selected tag labels and overflow count', () => {
    render(
      <Popover>
        <CompactTrigger
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

  it('keeps clear as a separate action from the popover trigger', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [tags, setTags] = useState(['agent'])
      return (
        <Popover>
          <CompactTrigger tags={tags} tagsMap={tagsMap} onTagsChange={setTags} />
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
