import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import UrlInput from '../url-input'

function CrawlRequestOwner() {
  const [pending, setPending] = useState(false)
  const [submittedUrl, setSubmittedUrl] = useState('')

  return (
    <>
      <UrlInput
        isRunning={pending}
        onRun={(url) => {
          setSubmittedUrl(url)
          setPending(true)
        }}
      />
      {submittedUrl && <output aria-label="Submitted crawl URL">{submittedUrl}</output>}
      {pending && (
        <button type="button" onClick={() => setPending(false)}>
          Finish crawl
        </button>
      )}
    </>
  )
}

it('preserves the submitted URL while a crawl is pending and allows retry afterward', async () => {
  const { wrapper: QueryProvider } = createConsoleQueryWrapper()
  await render(
    <QueryProvider>
      <CrawlRequestOwner />
    </QueryProvider>,
  )
  const input = page.getByRole('textbox')
  const run = page.getByRole('button', { name: 'datasetCreation.stepOne.website.run' })
  const url = 'https://example.com/docs?lang=en&version=2'

  await input.fill(url)
  await run.click()
  await expect
    .element(page.getByRole('status', { name: 'Submitted crawl URL' }))
    .toHaveTextContent(url)
  await expect.element(run).toHaveAttribute('aria-disabled', 'true')
  await expect.element(input).toHaveValue(url)

  await page.getByRole('button', { name: 'Finish crawl' }).click()
  await expect.element(run).not.toHaveAttribute('aria-disabled', 'true')
  await run.click()
  await expect.element(run).toHaveAttribute('aria-disabled', 'true')
  await expect.element(input).toHaveValue(url)
})
