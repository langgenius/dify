import type { CrawlOptions } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Options from '../options'

it('updates crawl limits and path filters without losing the other options', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const initial: CrawlOptions = {
    crawl_sub_pages: true,
    limit: 10,
    max_depth: 2,
    excludes: '',
    includes: '',
    only_main_content: false,
    use_sitemap: false,
  }
  function Harness() {
    const [payload, setPayload] = useState(initial)
    return (
      <Options
        payload={payload}
        onChange={(next) => {
          setPayload(next)
          onChange(next)
        }}
      />
    )
  }
  render(<Harness />)
  await user.click(screen.getByRole('checkbox', { name: /crawlSubPage/i }))
  await user.click(screen.getByRole('checkbox', { name: /extractOnlyMainContent/i }))
  const limit = screen.getByDisplayValue('10')
  await user.clear(limit)
  await user.type(limit, '50')
  const depth = screen.getByDisplayValue('2')
  await user.clear(depth)
  await user.type(depth, '5')
  await user.type(screen.getByPlaceholderText('blog/*, /about/*'), 'admin/*')
  await user.type(screen.getByPlaceholderText('articles/*'), 'public/*')
  expect(onChange).toHaveBeenLastCalledWith({
    ...initial,
    crawl_sub_pages: false,
    only_main_content: true,
    limit: 50,
    max_depth: 5,
    excludes: 'admin/*',
    includes: 'public/*',
  })
})
