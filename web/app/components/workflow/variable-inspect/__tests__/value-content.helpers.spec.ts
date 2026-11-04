import type { VarInInspect } from '@/types/workflow'
import { VarType } from '@/app/components/workflow/types'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import { VarInInspectType } from '@/types/workflow'
import {
  formatInspectFileValue,
  getValueEditorState,
  isFileValueUploaded,
  validateInspectJsonValue,
} from '../value-content.helpers'

describe('value-content helpers', () => {
  const createVar = (overrides: Partial<VarInInspect>): VarInInspect => ({
    id: 'var-1',
    description: '',
    edited: false,
    is_truncated: false,
    selector: ['node-1', 'query'],
    visible: true,
    name: 'query',
    type: VarInInspectType.node,
    value_type: VarType.string,
    value: '',
    ...overrides,
  })

  it('should derive editor modes from the variable shape', () => {
    expect(
      getValueEditorState(
        createVar({
          type: VarInInspectType.environment,
          name: 'api_key',
          value_type: VarType.string,
          value: 'secret',
        }),
      ),
    ).toMatchObject({
      showTextEditor: true,
      textEditorDisabled: true,
      showJSONEditor: false,
    })

    expect(
      getValueEditorState(
        createVar({
          name: 'payload',
          value_type: VarType.object,
          value: { foo: 1 },
          schemaType: 'general_structure',
        }),
      ),
    ).toMatchObject({
      showJSONEditor: true,
      hasChunks: true,
    })

    expect(
      getValueEditorState(
        createVar({
          type: VarInInspectType.system,
          name: 'files',
          value_type: VarType.arrayFile,
          value: [],
        }),
      ),
    ).toMatchObject({
      isSysFiles: true,
      showFileEditor: true,
      showJSONEditor: false,
    })
  })

  it('should format file values and detect upload completion', () => {
    expect(
      formatInspectFileValue(
        createVar({
          name: 'file',
          value_type: VarType.file,
          value: {
            id: 'file-1',
            filename: 'report.pdf',
            mime_type: 'application/pdf',
            type: 'document',
            transfer_method: 'remote_url',
            related_id: null,
            remote_url: 'https://example.com/report.pdf',
            size: 12,
          },
        }),
      ),
    ).toMatchObject([
      {
        id: '',
        name: 'report.pdf',
        size: 12,
        transferMethod: 'remote_url',
        url: 'https://example.com/report.pdf',
        progress: 100,
      },
    ])

    expect(isFileValueUploaded([{ upload_file_id: 'file-1' }])).toBe(true)
    expect(isFileValueUploaded([{ upload_file_id: 'uploaded' }, { upload_file_id: '' }])).toBe(
      false,
    )
    expect(
      formatInspectFileValue(
        createVar({
          type: VarInInspectType.system,
          name: 'files',
          value_type: VarType.arrayFile,
          value: [
            {
              id: 'file-2',
              filename: 'photo.png',
              type: 'image',
              transfer_method: 'local_file',
              related_id: 'upload-2',
              size: 20,
            },
          ],
        }),
      ),
    ).toMatchObject([
      {
        id: 'upload-2',
        uploadedId: 'upload-2',
        name: 'photo.png',
        size: 20,
        transferMethod: 'local_file',
        progress: 100,
      },
    ])
  })

  it('should validate json input and surface parse errors', () => {
    expect(validateInspectJsonValue('{"foo":1}', 'object').success).toBe(true)
    expect(validateInspectJsonValue('[]', 'array[any]')).toMatchObject({ success: true })
    expect(validateInspectJsonValue('{', 'object')).toMatchObject({
      success: false,
      parseError: expect.any(Error),
    })
  })
})

it('rejects arrays with values of the wrong type', () => {
  expect(validateInspectJsonValue('[1, 2]', 'array[string]')).toMatchObject({
    success: false,
    validationError: expect.stringContaining('string'),
    parseError: null,
  })
})

it('rejects deeply nested schemas through the real depth checker', () => {
  let schema: Record<string, unknown> = { type: 'string' }
  for (let depth = 0; depth <= JSON_SCHEMA_MAX_DEPTH; depth++)
    schema = { type: 'object', properties: { nested: schema } }
  expect(validateInspectJsonValue(JSON.stringify(schema), 'object')).toMatchObject({
    success: false,
    validationError: `Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`,
    parseError: null,
  })
})

it('reports Draft 7 violations instead of accepting a malformed schema', () => {
  expect(
    validateInspectJsonValue(JSON.stringify({ type: 'not-a-schema-type' }), 'object'),
  ).toMatchObject({
    success: false,
    validationError: expect.stringContaining('type'),
    parseError: null,
  })
})
