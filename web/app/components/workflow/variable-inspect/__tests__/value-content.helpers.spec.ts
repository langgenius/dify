import type { VarInInspect } from '@/types/workflow'
import { VarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { VarInInspectType } from '@/types/workflow'
import {
  formatInspectFileValue,
  getValueEditorState,
  isFileValueUploaded,
  validateInspectJsonValue,
} from '../value-content.helpers'

describe('value-content helpers', () => {
  const createFileValue = (id: string) => ({
    related_id: id,
    extension: '.txt',
    filename: `${id}.txt`,
    size: 1,
    mime_type: 'text/plain',
    transfer_method: TransferMethod.local_file,
    type: 'document',
    url: `https://example.com/${id}.txt`,
    upload_file_id: `${id}-upload`,
    remote_url: '',
  })

  const createVar = (overrides: Partial<VarInInspect>): VarInInspect => ({
    id: 'var-1',
    name: 'query',
    type: VarInInspectType.node,
    value_type: VarType.string,
    value: '',
    ...overrides,
  } as VarInInspect)

  it('should derive editor modes from the variable shape', () => {
    expect(getValueEditorState(createVar({
      type: VarInInspectType.environment,
      name: 'api_key',
      value_type: VarType.string,
      value: 'secret',
    }))).toMatchObject({
      showTextEditor: true,
      textEditorDisabled: true,
      showJSONEditor: false,
    })

    expect(getValueEditorState(createVar({
      name: 'payload',
      value_type: VarType.object,
      value: { foo: 1 },
      schemaType: 'general_structure',
    }))).toMatchObject({
      showJSONEditor: true,
      hasChunks: true,
    })

    expect(getValueEditorState(createVar({
      type: VarInInspectType.system,
      name: 'files',
      value_type: VarType.arrayFile,
      value: [],
    }))).toMatchObject({
      isSysFiles: true,
      showFileEditor: true,
      showJSONEditor: false,
    })
  })

  it('should format file values and detect upload completion', () => {
    expect(formatInspectFileValue(createVar({
      name: 'file',
      value_type: VarType.file,
      value: createFileValue('file-1'),
    }))).toHaveLength(1)

    expect(isFileValueUploaded([{ upload_file_id: 'file-1' }])).toBe(true)
    expect(isFileValueUploaded([{ upload_file_id: '' }])).toBe(false)
    expect(formatInspectFileValue(createVar({
      type: VarInInspectType.system,
      name: 'files',
      value_type: VarType.arrayFile,
      value: [createFileValue('file-2')],
    }))).toHaveLength(1)
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
