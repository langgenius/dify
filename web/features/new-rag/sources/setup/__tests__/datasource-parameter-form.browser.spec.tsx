import type { DatasourceParameters, DatasourceParameterSchema } from '../datasource-parameter-model'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WebsiteDatasourceParameterForm } from '../datasource-parameter-form'

const schemas: DatasourceParameterSchema[] = [
  {
    label: { en_US: 'Include subpages' },
    name: 'include_subpages',
    options: [],
    required: false,
    type: 'boolean',
  },
]

function ScrollableCrawlOptions() {
  const [parameters, setParameters] = useState<DatasourceParameters>({ include_subpages: true })

  return (
    <section
      aria-label="Source setup"
      style={{ position: 'relative', height: 360, overflow: 'hidden' }}
    >
      <h1>Connect a source</h1>
      <div style={{ height: 260, overflowY: 'auto' }}>
        <div style={{ height: 500 }} />
        <WebsiteDatasourceParameterForm
          parameters={parameters}
          schemas={schemas}
          onChange={setParameters}
        />
        <div style={{ height: 500 }} />
      </div>
      <button type="button">Cancel</button>
    </section>
  )
}

it('keeps the surrounding panel in place when clicking a scrolled crawl option label', async () => {
  await page.viewport(900, 600)
  const screen = await render(<ScrollableCrawlOptions />)
  await screen.getByRole('button', { name: 'knowledgeSources.crawlOptions' }).click()
  const label = screen.getByText('Include subpages', { exact: true })
  const checkbox = screen.getByRole('checkbox', { name: 'Include subpages' })
  const panel = screen.getByRole('region', { name: 'Source setup' }).element()
  const heading = screen.getByRole('heading', { name: 'Connect a source' }).element()
  const headingTop = heading.getBoundingClientRect().top

  await label.click()
  await expect.element(checkbox).not.toBeChecked()
  expect(panel.scrollTop).toBe(0)
  expect(heading.getBoundingClientRect().top).toBe(headingTop)

  await label.click()
  await expect.element(checkbox).toBeChecked()
  expect(panel.scrollTop).toBe(0)
  expect(heading.getBoundingClientRect().top).toBe(headingTop)
})
