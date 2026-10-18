import type { CrawlResultItem } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import CrawledResult from '../crawled-result'

const createMockItem = (overrides: Partial<CrawlResultItem> = {}): CrawlResultItem => ({
  title: 'Test Page',
  markdown: '# Test',
  description: 'A test page',
  source_url: 'https://example.com',
  ...overrides,
})

const createMockList = (): CrawlResultItem[] => [
  createMockItem({ title: 'Page 1', source_url: 'https://example.com/1' }),
  createMockItem({ title: 'Page 2', source_url: 'https://example.com/2' }),
  createMockItem({ title: 'Page 3', source_url: 'https://example.com/3' }),
]

it('selects individual pages, previews without selecting, and toggles all pages', async () => {
  const user = userEvent.setup()
  const list = createMockList()
  const onSelectedChange = vi.fn()
  const onPreview = vi.fn()
  function Harness() {
    const [selected, setSelected] = useState<CrawlResultItem[]>([list[0]!])
    return (
      <CrawledResult
        list={list}
        checkedList={selected}
        onSelectedChange={(next) => {
          setSelected(next)
          onSelectedChange(next)
        }}
        onPreview={onPreview}
        usedTime={1.5}
      />
    )
  }
  render(<Harness />)
  await user.click(screen.getByRole('checkbox', { name: /Page 2/ }))
  expect(onSelectedChange).toHaveBeenLastCalledWith([list[0], list[1]])
  await user.click(screen.getByRole('checkbox', { name: /Page 1/ }))
  expect(onSelectedChange).toHaveBeenLastCalledWith([list[1]])
  await user.click(screen.getAllByRole('button', { name: /preview/i })[2]!)
  expect(onPreview).toHaveBeenCalledWith(list[2])
  expect(screen.getByRole('checkbox', { name: /Page 3/ })).not.toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: /selectAll/i }))
  expect(onSelectedChange).toHaveBeenLastCalledWith(list)
  await user.click(screen.getByRole('checkbox', { name: /resetAll/i }))
  expect(onSelectedChange).toHaveBeenLastCalledWith([])
})
