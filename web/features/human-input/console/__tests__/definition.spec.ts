import type {
  ConsoleHumanInputV2FormDefinitionResponse,
  ResolvedForm,
} from '@dify/contracts/api/console/form/types.gen'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { normalizeConsoleFormDefinition } from '../definition'

const createResponse = (
  overrides: Partial<ResolvedForm> = {},
): ConsoleHumanInputV2FormDefinitionResponse => ({
  expiration_time: 1_900_000_000,
  resolved_form: {
    title: 'Review request',
    legacy_form_content: 'Unrelated legacy body {{#$output.OldField#}}',
    parts: [],
    actions: [{ id: 'Approve_A', title: 'Approve', button_style: 'primary' }],
    ...overrides,
  },
})

describe('normalizeConsoleFormDefinition', () => {
  it('renders authoritative parts in source order with case-sensitive field and action names', () => {
    const definition = normalizeConsoleFormDefinition(
      createResponse({
        parts: [
          { type: 'markdown_fragment', text: '# Please review\n\n' },
          {
            type: 'paragraph_input',
            output_variable_name: 'ReviewNote',
            default_value: 'First\nSecond',
          },
          { type: 'markdown_fragment', text: '\n\nDecision: ' },
          {
            type: 'select_input',
            output_variable_name: 'Decision',
            options: ['Accept', 'Reject'],
            default_value: 'Accept',
          },
          { type: 'markdown_fragment', text: '\n\nThank you.' },
        ],
      }),
    )

    expect(definition.formContent).toBe(
      '# Please review\n\n{{#$output.ReviewNote#}}\n\nDecision: {{#$output.Decision#}}\n\nThank you.',
    )
    expect(definition.inputs).toEqual([
      {
        type: InputVarType.paragraph,
        output_variable_name: 'ReviewNote',
        default: { type: 'constant', value: 'First\nSecond', selector: [] },
      },
      {
        type: InputVarType.select,
        output_variable_name: 'Decision',
        option_source: { type: 'constant', value: ['Accept', 'Reject'], selector: [] },
      },
    ])
    expect(definition.resolvedDefaultValues).toEqual({
      ReviewNote: 'First\nSecond',
      Decision: 'Accept',
    })
    expect(definition.actions).toEqual([
      { id: 'Approve_A', title: 'Approve', button_style: 'primary' },
    ])
    expect(definition.expirationTime).toBe(1_900_000_000)
  })

  it('retains repeated output slots with one input configuration per field', () => {
    const field = {
      type: 'paragraph_input',
      output_variable_name: 'Note',
      default_value: 'Same value',
    } satisfies ResolvedForm['parts'][number]
    const definition = normalizeConsoleFormDefinition(
      createResponse({ parts: [field, { type: 'markdown_fragment', text: '\nAgain: ' }, field] }),
    )

    expect(definition.formContent).toBe('{{#$output.Note#}}\nAgain: {{#$output.Note#}}')
    expect(definition.inputs.map((input) => input.output_variable_name)).toEqual(['Note'])
    expect(definition.resolvedDefaultValues).toEqual({ Note: 'Same value' })
  })

  it('distinguishes absent defaults from intentionally empty text and selection defaults', () => {
    const definition = normalizeConsoleFormDefinition(
      createResponse({
        parts: [
          { type: 'paragraph_input', output_variable_name: 'NoDefault', default_value: null },
          { type: 'paragraph_input', output_variable_name: 'EmptyText', default_value: '' },
          {
            type: 'select_input',
            output_variable_name: 'NoSelection',
            options: ['A'],
            default_value: null,
          },
          {
            type: 'select_input',
            output_variable_name: 'EmptySelection',
            options: ['', 'A'],
            default_value: '',
          },
        ],
      }),
    )

    expect(definition.resolvedDefaultValues).toEqual({ EmptyText: '', EmptySelection: '' })
    expect(definition.inputs[0]).toMatchObject({ default: { type: 'constant', value: '' } })
  })

  it('preserves single and multiple file restrictions without inventing string defaults', () => {
    const definition = normalizeConsoleFormDefinition(
      createResponse({
        parts: [
          {
            type: 'file_input',
            output_variable_name: 'EvidenceImage',
            allowed_file_types: ['image', 'custom'],
            allowed_file_extensions: ['.png', '.webp'],
            allowed_file_upload_methods: ['local_file', 'remote_url'],
          },
          {
            type: 'file_list_input',
            output_variable_name: 'Documents',
            allowed_file_types: ['document'],
            allowed_file_extensions: ['.pdf'],
            allowed_file_upload_methods: ['local_file'],
            number_limits: 3,
          },
        ],
      }),
    )

    expect(definition.formContent).toBe('{{#$output.EvidenceImage#}}{{#$output.Documents#}}')
    expect(definition.inputs).toEqual([
      {
        type: InputVarType.singleFile,
        output_variable_name: 'EvidenceImage',
        allowed_file_types: [SupportUploadFileTypes.image, SupportUploadFileTypes.custom],
        allowed_file_extensions: ['.png', '.webp'],
        allowed_file_upload_methods: ['local_file', 'remote_url'],
      },
      {
        type: InputVarType.multiFiles,
        output_variable_name: 'Documents',
        allowed_file_types: [SupportUploadFileTypes.document],
        allowed_file_extensions: ['.pdf'],
        allowed_file_upload_methods: ['local_file'],
        number_limits: 3,
      },
    ])
    expect(definition.resolvedDefaultValues).toEqual({})
  })

  it('uses the shared uploader restriction for interactive transfer methods', () => {
    const definition = normalizeConsoleFormDefinition(
      createResponse({
        parts: [
          {
            type: 'file_input',
            output_variable_name: 'Attachment',
            allowed_file_types: ['document'],
            allowed_file_extensions: [],
            allowed_file_upload_methods: [
              'tool_file',
              'local_file',
              'datasource_file',
              'remote_url',
            ],
          },
        ],
      }),
    )

    expect(definition.inputs[0]).toMatchObject({
      allowed_file_upload_methods: ['local_file', 'remote_url'],
    })
  })

  it('does not resurrect legacy controls when the authoritative form has no parts', () => {
    const definition = normalizeConsoleFormDefinition(createResponse())

    expect(definition.formContent).toBe('')
    expect(definition.inputs).toEqual([])
    expect(definition.resolvedDefaultValues).toEqual({})
  })
})
