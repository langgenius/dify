import type { CrawlResultItem } from '@/models/datasets'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import CrawledResult from '../crawled-result'

const pages: CrawlResultItem[] = [
  {
    title: 'Page 1',
    markdown: '# One',
    description: 'First page',
    source_url: 'https://example.com/1',
  },
  {
    title: 'Page 2',
    markdown: '# Two',
    description: 'Second page',
    source_url: 'https://example.com/2',
  },
  {
    title: 'Page 3',
    markdown: '# Three',
    description: 'Third page',
    source_url: 'https://example.com/3',
  },
]

function CrawlResultOwner() {
  const [selected, setSelected] = useState<CrawlResultItem[]>([pages[0]!])
  const [previewed, setPreviewed] = useState<CrawlResultItem>()

  return (
    <>
      <CrawledResult
        list={pages}
        checkedList={selected}
        onSelectedChange={setSelected}
        onPreview={setPreviewed}
        usedTime={1.5}
      />
      {previewed && <output aria-label="Previewed page">{previewed.title}</output>}
    </>
  )
}

it('selects crawl results and previews a hovered page without selecting it', async () => {
  await render(<CrawlResultOwner />)
  const first = page.getByRole('checkbox', { name: /Page 1/ })
  const second = page.getByRole('checkbox', { name: /Page 2/ })
  const third = page.getByRole('checkbox', { name: /Page 3/ })

  await second.click()
  await expect.element(first).toBeChecked()
  await expect.element(second).toBeChecked()
  await first.click()
  await expect.element(first).not.toBeChecked()

  await third.hover()
  const preview = page.getByRole('button', { name: /preview/i })
  await expect.element(preview).toBeVisible()
  expect(preview.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await preview.click()
  await expect
    .element(page.getByRole('status', { name: 'Previewed page' }))
    .toHaveTextContent('Page 3')
  await expect.element(third).not.toBeChecked()

  await page.getByRole('checkbox', { name: /selectAll/i }).click()
  await expect.element(first).toBeChecked()
  await expect.element(second).toBeChecked()
  await expect.element(third).toBeChecked()
  await page.getByRole('checkbox', { name: /resetAll/i }).click()
  await expect.element(first).not.toBeChecked()
  await expect.element(second).not.toBeChecked()
  await expect.element(third).not.toBeChecked()
})
