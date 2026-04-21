import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SearchBoxWrapper from '../search-box-wrapper'

const mockHandleSearchPluginTextChange = vi.fn()
const mockHandleFilterPluginTagsChange = vi.fn()
const mockSearchBox = vi.fn()

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('../../atoms', () => ({
  useSearchPluginText: () => ['plugin search', mockHandleSearchPluginTextChange],
  useFilterPluginTags: () => [['agent', 'rag'], mockHandleFilterPluginTagsChange],
}))

vi.mock('../index', () => ({
  default: (props: Record<string, unknown>) => {
    mockSearchBox(props)
    return <div data-testid="search-box">search-box</div>
  },
}))

describe('SearchBoxWrapper', () => {
  it('passes marketplace search state into SearchBox', () => {
    render(<SearchBoxWrapper />)

    expect(screen.getByTestId('search-box')).toBeInTheDocument()
    expect(mockSearchBox).toHaveBeenCalledWith(expect.objectContaining({
      wrapperClassName: 'z-11 mx-auto w-[640px] shrink-0',
      inputClassName: 'w-full',
      search: 'plugin search',
      onSearchChange: mockHandleSearchPluginTextChange,
      tags: ['agent', 'rag'],
      onTagsChange: mockHandleFilterPluginTagsChange,
      placeholder: 'plugin.searchPlugins',
      usedInMarketplace: true,
    }))
  })
})
