import type { DatasourceParameters, DatasourceParameterSchema } from '../datasource-parameter-model'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render } from '@/test/console/render'
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

function NumberParameterForm() {
  const [parameters, setParameters] = useState<DatasourceParameters>({})
  return (
    <DatasourceParameterForm
      parameters={parameters}
      schemas={[limitSchema]}
      onChange={setParameters}
    />
  )
}

function UrlParameterForm() {
  const [parameters, setParameters] = useState<DatasourceParameters>({})
  return (
    <DatasourceParameterForm
      parameters={parameters}
      schemas={[urlSchema]}
      onChange={setParameters}
    />
  )
}

function DecimalParameterForm() {
  const [parameters, setParameters] = useState<DatasourceParameters>({})
  return (
    <DatasourceParameterForm
      parameters={parameters}
      schemas={[decimalSchema]}
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

function GroupedWebsiteParameterForm() {
  const schemas = websiteDatasourceParameterSchemas({ parameters: [] } as never)
  const [parameters, setParameters] = useState<DatasourceParameters>(() =>
    datasourceParameterDefaults(schemas),
  )
  return (
    <WebsiteDatasourceParameterForm
      parameters={parameters}
      schemas={schemas}
      onChange={setParameters}
    />
  )
}

function CustomizedGroupedWebsiteParameterForm() {
  const schemas = websiteDatasourceParameterSchemas({ parameters: [] } as never)
  const [parameters, setParameters] = useState<DatasourceParameters>(() => ({
    ...datasourceParameterDefaults(schemas),
    limit: 99,
  }))
  return (
    <WebsiteDatasourceParameterForm
      parameters={parameters}
      schemas={schemas}
      onChange={setParameters}
    />
  )
}

describe('DatasourceParameterForm', () => {
  it('keeps an out-of-range numeric value visible and reports it as invalid', async () => {
    const user = userEvent.setup()
    render(<NumberParameterForm />)

    const input = screen.getByRole('spinbutton', { name: 'Limit' })
    await user.type(input, '15')
    expect(input).toHaveValue(15)

    await user.tab()
    expect(input).toHaveValue(15)
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('associates an actionable error with an invalid URL field', async () => {
    const user = userEvent.setup()
    render(<UrlParameterForm />)

    const input = screen.getByRole('textbox', { name: 'Root URL' })
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('dataset.newKnowledge.invalidRootUrl')).not.toBeInTheDocument()

    await user.type(input, 'ftp://example.com')
    await user.tab()

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('dataset.newKnowledge.invalidRootUrl')
    expect(screen.getByText('dataset.newKnowledge.invalidRootUrl')).toBeInTheDocument()
  })

  it('groups website options and resets edits to provider defaults', async () => {
    const user = userEvent.setup()
    render(<GroupedWebsiteParameterForm />)

    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.rootUrl' })).toBeVisible()
    const crawlOptions = screen.getByRole('button', {
      name: 'dataset.newKnowledge.crawlOptions',
    })
    expect(crawlOptions).toHaveAttribute('aria-expanded', 'false')
    expect(crawlOptions).toHaveTextContent('dataset.newKnowledge.usingDefaults')
    expect(
      screen.queryByRole('checkbox', { name: 'dataset.newKnowledge.includeSubpages' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.newKnowledge.resetToDefaults' }),
    ).not.toBeInTheDocument()

    await user.click(crawlOptions)
    const includeSubpages = screen.getByRole('checkbox', {
      name: 'dataset.newKnowledge.includeSubpages',
    })
    const resetButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.resetToDefaults',
    })
    expect(includeSubpages).toBeChecked()
    expect(resetButton).toBeEnabled()
    expect(screen.getByRole('spinbutton', { name: 'dataset.newKnowledge.maxPages' })).toBeVisible()

    await user.click(includeSubpages)
    expect(includeSubpages).not.toBeChecked()
    expect(resetButton).toBeEnabled()

    await user.click(resetButton)
    expect(includeSubpages).toBeChecked()
  })

  it('does not describe customized collapsed website options as defaults', () => {
    render(<CustomizedGroupedWebsiteParameterForm />)

    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.crawlOptions' }),
    ).not.toHaveTextContent('dataset.newKnowledge.usingDefaults')
  })

  it('allows decimal input using the declaration precision', async () => {
    const user = userEvent.setup()
    render(<DecimalParameterForm />)

    const input = screen.getByRole('spinbutton', { name: 'Threshold' })
    expect(input).toHaveAttribute('inputmode', 'decimal')
    expect(input).toHaveAttribute('step', '0.01')

    await user.type(input, '0.25')
    expect(input).toHaveValue(0.25)
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('resolves translation keys for legacy website parameter labels', () => {
    render(<LegacyWebsiteParameterForm />)

    expect(screen.getByRole('textbox', { name: 'dataset.newKnowledge.rootUrl' })).toHaveAttribute(
      'placeholder',
      'dataset.newKnowledge.rootUrlPlaceholder',
    )
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.includeSubpages' }),
    ).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'dataset.newKnowledge.maxPages' })).toHaveValue(
      100,
    )
  })
})
