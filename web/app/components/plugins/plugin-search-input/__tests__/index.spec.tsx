import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { PluginSearchInput } from '..'

function SearchHarness() {
  const [value, setValue] = useState('agent')
  const [tags, setTags] = useState(['rag'])
  return (
    <PluginSearchInput
      value={value}
      onValueChange={setValue}
      tags={tags}
      onTagsChange={setTags}
      placeholder="Search plugins"
    />
  )
}

describe('PluginSearchInput', () => {
  it('clears search from the keyboard without clearing tags, and restores input focus', async () => {
    const user = userEvent.setup()
    render(<SearchHarness />)
    const input = screen.getByRole('searchbox', { name: 'Search plugins' })
    await user.click(input)
    await user.tab()
    expect(screen.getByRole('button', { name: /^plugin\.clearSearch/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: 'pluginTags.tags.rag' })).toBeInTheDocument()
  })

  it('keeps tag selection, popup search and tag clearing independent of the main input', async () => {
    const user = userEvent.setup()
    render(<SearchHarness />)
    const input = screen.getByRole('searchbox', { name: 'Search plugins' })
    const trigger = screen.getByRole('button', { name: 'pluginTags.tags.rag' })
    await user.click(trigger)
    const tagSearch = await screen.findByRole('searchbox', { name: 'pluginTags.searchTags' })
    await user.type(tagSearch, 'agent')
    expect(tagSearch).toHaveFocus()
    await user.click(screen.getByRole('checkbox', { name: 'pluginTags.tags.agent' }))
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(input).toHaveValue('agent')
    await user.tab()
    expect(screen.getByRole('button', { name: /^pluginTags\.clearSelectedTags/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'pluginTags.allTags' })).toHaveFocus()
    expect(input).toHaveValue('agent')
    expect(
      screen.queryByRole('searchbox', { name: 'pluginTags.searchTags' }),
    ).not.toBeInTheDocument()
  })

  it('commits composed text once and exposes the native input for picker focus', () => {
    const onValueChange = vi.fn()
    const ref = createRef<HTMLInputElement>()
    render(
      <PluginSearchInput
        ref={ref}
        value=""
        onValueChange={onValueChange}
        tags={[]}
        onTagsChange={vi.fn()}
        placeholder="Search plugins"
      />,
    )
    const input = screen.getByRole('searchbox', { name: 'Search plugins' })
    expect(ref.current).toBe(input)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '搜索' } })
    expect(input).toHaveValue('搜索')
    expect(onValueChange).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.change(input, { target: { value: '搜索' } })
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('搜索')
  })
})
