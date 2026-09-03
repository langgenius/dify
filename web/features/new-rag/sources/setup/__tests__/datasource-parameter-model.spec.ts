import {
  datasourceParameterDefaults,
  datasourceParameterRecord,
  datasourceParameterSchemas,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  websiteDatasourceParameterSchemas,
  withDatasourceParameterDefaults,
} from '../datasource-parameter-model'

describe('datasource parameter model', () => {
  it('parses plugin-declared fields and applies defaults without replacing saved values', () => {
    const schemas = datasourceParameterSchemas({
      parameters: [
        {
          default: 'basic',
          label: { en_US: 'Search depth' },
          name: 'search_depth',
          options: [
            { label: { en_US: 'Basic' }, value: 'basic' },
            { label: { en_US: 'Advanced' }, value: 'advanced' },
          ],
          required: true,
          type: 'select',
        },
        {
          label: { en_US: 'Query' },
          name: 'query',
          required: true,
          type: 'string',
        },
      ],
    } as never)

    expect(datasourceParameterDefaults(schemas)).toEqual({ search_depth: 'basic' })
    expect(withDatasourceParameterDefaults(schemas, { search_depth: 'advanced' })).toEqual({
      search_depth: 'advanced',
    })
    expect(missingRequiredDatasourceParameters(schemas, { search_depth: 'advanced' })).toEqual([
      expect.objectContaining({ name: 'query' }),
    ])
  })

  it('validates URL, numeric, and select constraints from a declaration', () => {
    const schemas = datasourceParameterSchemas({
      parameters: [
        { label: { en_US: 'URL' }, name: 'url', required: true, type: 'string' },
        { label: { en_US: 'Limit' }, max: 200, min: 1, name: 'limit', type: 'integer' },
        {
          label: { en_US: 'Mode' },
          name: 'mode',
          options: [{ label: { en_US: 'One' }, value: 'one' }],
          type: 'select',
        },
      ],
    } as never)

    expect(
      invalidDatasourceParameters(schemas, {
        limit: 201,
        mode: 'unknown',
        url: 'ftp://example.com',
      }).map((schema) => schema.name),
    ).toEqual(['url', 'limit', 'mode'])
    expect(
      invalidDatasourceParameters(schemas, {
        limit: 1.5,
        mode: 'one',
        url: 'https://example.com',
      }).map((schema) => schema.name),
    ).toEqual(['limit'])
    expect(
      invalidDatasourceParameters(schemas, {
        limit: 25,
        mode: 'one',
        url: 'https://example.com',
      }),
    ).toEqual([])
  })

  it('preserves and validates decimal precision for numeric parameters', () => {
    const schemas = datasourceParameterSchemas({
      parameters: [
        { label: { en_US: 'Threshold' }, name: 'threshold', precision: 2, type: 'number' },
      ],
    } as never)

    expect(schemas[0]).toEqual(expect.objectContaining({ precision: 2, type: 'number' }))
    expect(invalidDatasourceParameters(schemas, { threshold: 0.25 })).toEqual([])
    expect(invalidDatasourceParameters(schemas, { threshold: 0.251 })).toEqual([
      expect.objectContaining({ name: 'threshold' }),
    ])
  })

  it('keeps legacy website providers functional when their declaration has no fields', () => {
    const schemas = websiteDatasourceParameterSchemas({ parameters: [] } as never)

    expect(schemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'url', required: true }),
        expect.objectContaining({ defaultValue: true, name: 'crawl_subpages' }),
        expect.objectContaining({ defaultValue: 100, name: 'limit' }),
      ]),
    )
    expect(schemas[0]).toEqual(
      expect.objectContaining({
        label: {},
        labelTranslationKey: 'rootUrl',
        placeholder: {},
        placeholderTranslationKey: 'rootUrlPlaceholder',
      }),
    )
  })

  it('uses the provider-specific legacy subpage parameter name', () => {
    expect(
      websiteDatasourceParameterSchemas({
        identity: { name: 'jina_reader', provider: 'jinareader' },
        parameters: [],
      } as never),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'crawl_sub_pages' })]))
  })

  it('retains required unsupported parameters so the datasource cannot run without them', () => {
    const schemas = datasourceParameterSchemas({
      parameters: [
        {
          label: { en_US: 'Private token' },
          name: 'private_token',
          required: true,
          type: 'secret-input',
        },
        {
          label: { en_US: 'Attachment' },
          name: 'attachment',
          required: false,
          type: 'file',
        },
      ],
    } as never)

    expect(schemas).toEqual([
      expect.objectContaining({ name: 'private_token', type: 'unsupported' }),
      expect.objectContaining({ name: 'attachment', type: 'unsupported' }),
    ])
    expect(missingRequiredDatasourceParameters(schemas, {})).toEqual([
      expect.objectContaining({ name: 'private_token' }),
    ])
    expect(invalidDatasourceParameters(schemas, { attachment: 'file-1' })).toEqual([
      expect.objectContaining({ name: 'attachment' }),
    ])
  })

  it('accepts only bounded scalar draft parameters', () => {
    expect(datasourceParameterRecord({ enabled: true, limit: 5, query: 'dify' })).toEqual({
      enabled: true,
      limit: 5,
      query: 'dify',
    })
    expect(datasourceParameterRecord({ nested: { token: 'no' } })).toBeUndefined()
    expect(datasourceParameterRecord({ value: Number.NaN })).toBeUndefined()
  })
})
