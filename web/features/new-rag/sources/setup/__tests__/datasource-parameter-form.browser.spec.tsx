import type { DatasourceParameters, DatasourceParameterSchema } from '../datasource-parameter-model'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import {
  DatasourceParameterForm,
  WebsiteDatasourceParameterForm,
} from '../datasource-parameter-form'
import {
  datasourceParameterDefaults,
  websiteDatasourceParameterSchemas,
} from '../datasource-parameter-model'

const limitSchema: DatasourceParameterSchema = {
  label: { en_US: 'Limit' },
  max: 200,
  min: 100,
  name: 'limit',
  options: [],
  required: true,
  type: 'number',
}

const urlSchema: DatasourceParameterSchema = {
  label: { en_US: 'Root URL' },
  name: 'url',
  options: [],
  required: true,
  type: 'string',
}

const decimalSchema: DatasourceParameterSchema = {
  label: { en_US: 'Threshold' },
  name: 'threshold',
  options: [],
  precision: 2,
  required: false,
  type: 'number',
}

function ParameterForm({ schema }: { schema: DatasourceParameterSchema }) {
  const [parameters, setParameters] = useState<DatasourceParameters>({})
  return (
    <DatasourceParameterForm parameters={parameters} schemas={[schema]} onChange={setParameters} />
  )
}

function WebsiteParameterForm({ customized = false }: { customized?: boolean }) {
  const schemas = websiteDatasourceParameterSchemas({ parameters: [] } as never)
  const [parameters, setParameters] = useState<DatasourceParameters>(() => ({
    ...datasourceParameterDefaults(schemas),
    ...(customized ? { limit: 99 } : {}),
  }))
  return (
    <WebsiteDatasourceParameterForm
      parameters={parameters}
      schemas={schemas}
      onChange={setParameters}
    />
  )
}

function LegacyWebsiteParameterForm() {
  const schemas = websiteDatasourceParameterSchemas({ parameters: [] } as never)
  const [parameters, setParameters] = useState<DatasourceParameters>(() =>
    datasourceParameterDefaults(schemas),
  )
  return (
    <DatasourceParameterForm parameters={parameters} schemas={schemas} onChange={setParameters} />
  )
}

const scrollSchema: DatasourceParameterSchema[] = [
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
          schemas={scrollSchema}
          onChange={setParameters}
        />
        <div style={{ height: 500 }} />
      </div>
      <button type="button">Cancel</button>
    </section>
  )
}

describe('DatasourceParameterForm', () => {
  beforeEach(async () => {
    await page.viewport(900, 600)
    onTestFinished(guardUnexpectedFetch())
  })

  it('keeps an out-of-range number visible and exposes native and accessible invalid state', async () => {
    const screen = await render(<ParameterForm schema={limitSchema} />)
    const input = screen.getByRole('spinbutton', { name: 'Limit' })

    await input.fill('15')
    await userEvent.tab()

    await expect.element(input).toHaveValue(15)
    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    expect((input.element() as HTMLInputElement).validity.rangeUnderflow).toBe(true)
  })

  it('associates the actionable URL error after native blur validation', async () => {
    const screen = await render(<ParameterForm schema={urlSchema} />)
    const input = screen.getByRole('textbox', { name: 'Root URL' })

    await input.fill('ftp://example.com')
    await userEvent.tab()

    await expect.element(input).toHaveAttribute('aria-invalid', 'true')
    await expect.element(input).toHaveAccessibleDescription('dataset.validation.invalidHttpUrl')
    await expect.element(screen.getByText('dataset.validation.invalidHttpUrl')).toBeVisible()
    await expect.element(input).toHaveValue('ftp://example.com')
  })

  it('reveals website options, applies edits, and resets them to provider defaults', async () => {
    const screen = await render(<WebsiteParameterForm />)
    const crawlOptions = screen.getByRole('button', { name: 'knowledgeSources.crawlOptions' })

    await expect.element(crawlOptions).toHaveAttribute('aria-expanded', 'false')
    await expect.element(crawlOptions).toMatchTextContent('knowledgeSources.usingDefaults')
    await crawlOptions.click()
    const includeSubpages = screen.getByRole('checkbox', {
      name: 'knowledgeSources.includeSubpages',
    })
    const reset = screen.getByRole('button', { name: 'knowledgeSources.resetToDefaults' })
    await expect.element(includeSubpages).toBeChecked()
    await includeSubpages.click()
    await expect.element(includeSubpages).not.toBeChecked()
    await reset.click()
    await expect.element(includeSubpages).toBeChecked()
  })

  it('does not describe customized collapsed website options as defaults', async () => {
    const customized = await render(<WebsiteParameterForm customized />)
    const trigger = customized.getByRole('button', { name: 'knowledgeSources.crawlOptions' })
    await expect.element(trigger).toHaveTextContent('knowledgeSources.crawlOptions')
  })

  it('preserves declaration precision through the native decimal input', async () => {
    const decimal = await render(<ParameterForm schema={decimalSchema} />)
    const input = decimal.getByRole('spinbutton', { name: 'Threshold' })
    await expect.element(input).toHaveAttribute('inputmode', 'decimal')
    await expect.element(input).toHaveAttribute('step', '0.01')
    await input.fill('0.25')
    await expect.element(input).toHaveValue(0.25)
    expect((input.element() as HTMLInputElement).validity.valid).toBe(true)
  })

  it('resolves the legacy website controls to their public labels and native values', async () => {
    const screen = await render(<LegacyWebsiteParameterForm />)

    await expect
      .element(screen.getByRole('textbox', { name: 'knowledgeSources.rootUrl' }))
      .toHaveAttribute('placeholder', 'knowledgeSources.rootUrlPlaceholder')
    await expect
      .element(screen.getByRole('switch', { name: 'knowledgeSources.includeSubpages' }))
      .toBeChecked()
    await expect
      .element(screen.getByRole('spinbutton', { name: 'knowledgeSources.maxPages' }))
      .toHaveValue(100)
  })

  it('keeps the surrounding panel in place when clicking a scrolled crawl option label', async () => {
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
})
