import type { CrawlOptions } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Options from '../options'

it('edits Jina crawl options while preserving the other crawl settings', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const initial: CrawlOptions = {
    crawl_sub_pages: true,
    use_sitemap: false,
    limit: 10,
    max_depth: 2,
    excludes: '/private',
    includes: '/docs',
    only_main_content: false,
  }
  const Harness = () => {
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
  await user.click(screen.getByRole('checkbox', { name: /crawlSubPage/ }))
  await user.click(screen.getByRole('checkbox', { name: /useSitemap/ }))
  const limit = screen.getByDisplayValue('10')
  await user.clear(limit)
  await user.type(limit, '50')
  expect(onChange).toHaveBeenLastCalledWith({
    ...initial,
    crawl_sub_pages: false,
    use_sitemap: true,
    limit: 50,
  })
})
