import type { CrawlResultItem } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import CrawledResult from '../crawled-result'

const pages: CrawlResultItem[] = ['First', 'Second', 'Third'].map((title, index) => ({
  title,
  source_url: `https://example.com/${index}`,
  markdown: title,
  description: title,
}))
function Harness({ multiple = true, onChange = vi.fn(), onPreview = vi.fn() }) {
  const [selected, setSelected] = useState([pages[0]!])
  return (
    <CrawledResult
      list={pages}
      checkedList={selected}
      usedTime={12.3}
      isMultipleChoice={multiple}
      showPreview
      onPreview={onPreview}
      onSelectedChange={(next) => {
        setSelected(next)
        onChange(next)
      }}
    />
  )
}

it('adds and removes individual pages and supports selecting and resetting all', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Harness onChange={onChange} />)
  await user.click(screen.getByRole('checkbox', { name: 'Second https://example.com/1' }))
  expect(onChange).toHaveBeenLastCalledWith([pages[0], pages[1]])
  await user.click(screen.getByRole('checkbox', { name: 'First https://example.com/0' }))
  expect(onChange).toHaveBeenLastCalledWith([pages[1]])
  await user.click(
    screen.getByRole('checkbox', { name: 'datasetCreation.stepOne.website.selectAll' }),
  )
  expect(onChange).toHaveBeenLastCalledWith(pages)
  await user.click(
    screen.getByRole('checkbox', { name: 'datasetCreation.stepOne.website.resetAll' }),
  )
  expect(onChange).toHaveBeenLastCalledWith([])
})

it('replaces the selected page in single-choice mode and previews independently', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const onPreview = vi.fn()
  render(<Harness multiple={false} onChange={onChange} onPreview={onPreview} />)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'Second https://example.com/1' }))
  expect(onChange).toHaveBeenCalledWith([pages[1]])
  await user.click(
    screen.getAllByRole('button', { name: 'datasetCreation.stepOne.website.preview' })[2]!,
  )
  expect(onPreview).toHaveBeenCalledWith(pages[2], 2)
  expect(onChange).toHaveBeenCalledOnce()
})
