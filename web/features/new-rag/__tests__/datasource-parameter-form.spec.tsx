import type { DatasourceParameters, DatasourceParameterSchema } from '../datasource-parameter-model'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render } from '@/test/console/render'
import { DatasourceParameterForm } from '../datasource-parameter-form'
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
    await user.type(input, 'ftp://example.com')
    await user.tab()

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('dataset.newKnowledge.invalidRootUrl')
    expect(screen.getByText('dataset.newKnowledge.invalidRootUrl')).toBeInTheDocument()
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
