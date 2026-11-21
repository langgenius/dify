import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import OptionsWrap from '../options-wrap'

function CrawlOptionsOwner() {
  const [crawlAttempt, setCrawlAttempt] = useState(0)

  return (
    <>
      <button type="button" onClick={() => setCrawlAttempt((attempt) => attempt + 1)}>
        Start crawl
      </button>
      <OptionsWrap controlFoldOptions={crawlAttempt}>
        <label>
          Page limit
          <input defaultValue="10" />
        </label>
      </OptionsWrap>
    </>
  )
}

it('folds options after a crawl starts and lets the user reopen or close them', async () => {
  await render(<CrawlOptionsOwner />)
  const options = page.getByText('datasetCreation.stepOne.website.options')
  const limit = page.getByRole('textbox', { name: 'Page limit' })

  await expect.element(limit).toBeInTheDocument()
  await page.getByRole('button', { name: 'Start crawl' }).click()
  await expect.element(limit).not.toBeInTheDocument()
  await options.click()
  await expect.element(limit).toBeInTheDocument()
  await options.click()
  await expect.element(limit).not.toBeInTheDocument()
})
