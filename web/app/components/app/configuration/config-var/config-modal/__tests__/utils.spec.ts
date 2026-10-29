import type { ContractRouterClient } from '@orpc/contract'
import type { TFunction } from 'i18next'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVar } from '@/app/components/workflow/types'
import { contract } from '@dify/contracts/api/console/apps/orpc.gen'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { ChangeType, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import {
  buildSelectOptions,
  createPayloadForType,
  getCheckboxDefaultSelectValue,
  getJsonSchemaEditorValue,
  isJsonSchemaEmpty,
  isStringInputType,
  normalizeSelectDefaultValue,
  updatePayloadField,
  validateConfigModalPayload,
} from '../utils'

const t = withSelectorKey((key: string) => key) as TFunction<['appDebug', 'workflow']>

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: 'Question',
  variable: 'question',
  required: false,
  options: [],
  hide: false,
  ...overrides,
})

describe('config-modal utils', () => {
  describe('payload helpers', () => {
    it('should clear the default value when options no longer include it', () => {
      const payload = createInputVar({
        type: InputVarType.select,
        default: 'beta',
        options: ['alpha', 'beta'],
      })

      const nextPayload = updatePayloadField(payload, 'options', ['alpha'])

      expect(nextPayload.default).toBeUndefined()
      expect(nextPayload.options).toEqual(['alpha'])
    })

    it('should seed upload defaults when switching to multi-file input', () => {
      const payload = createInputVar({
        type: InputVarType.textInput,
        default: 'hello',
        hide: true,
      })

      const nextPayload = createPayloadForType(payload, InputVarType.multiFiles)

      expect(nextPayload.type).toBe(InputVarType.multiFiles)
      expect(nextPayload.hide).toBe(false)
      expect(nextPayload.max_length).toBe(DEFAULT_FILE_UPLOAD_SETTING.max_length)
      expect(nextPayload.allowed_file_types).toEqual(DEFAULT_FILE_UPLOAD_SETTING.allowed_file_types)
      expect(nextPayload.default).toBe('hello')
    })

    it('should clear the default value when switching to a select input type', () => {
      const payload = createInputVar({
        type: InputVarType.textInput,
        default: 'hello',
      })

      const nextPayload = createPayloadForType(payload, InputVarType.select)

      expect(nextPayload.type).toBe(InputVarType.select)
      expect(nextPayload.default).toBeUndefined()
    })

    it('should normalize empty select defaults to undefined', () => {
      const nextPayload = normalizeSelectDefaultValue(
        createInputVar({
          type: InputVarType.select,
          default: '',
        }),
      )

      expect(nextPayload.default).toBeUndefined()
    })

    it('should normalize json schema editor content', () => {
      expect(getJsonSchemaEditorValue(InputVarType.jsonObject, { type: 'object' } as never)).toBe(
        JSON.stringify({ type: 'object' }, null, 2),
      )
      expect(getJsonSchemaEditorValue(InputVarType.textInput, '{"type":"object"}')).toBe('')
      expect(getJsonSchemaEditorValue(InputVarType.jsonObject, '{"type":"object"}')).toBe(
        '{"type":"object"}',
      )
    })

    it('should fall back to an empty editor value when json schema serialization fails', () => {
      const circular: Record<string, unknown> = {}
      circular.self = circular

      expect(getJsonSchemaEditorValue(InputVarType.jsonObject, circular as never)).toBe('')
    })
  })

  describe('derived values', () => {
    it('should expose upload and json options only when supported', () => {
      const options = buildSelectOptions({
        isBasicApp: false,
        supportFile: true,
        t,
      })

      expect(options.map((option) => option.value)).toEqual(
        expect.arrayContaining([
          InputVarType.singleFile,
          InputVarType.multiFiles,
          InputVarType.jsonObject,
        ]),
      )
    })

    it('should derive checkbox defaults from boolean and string values', () => {
      expect(getCheckboxDefaultSelectValue(true)).toBe('true')
      expect(getCheckboxDefaultSelectValue('TRUE')).toBe('true')
      expect(getCheckboxDefaultSelectValue(undefined)).toBe('false')
    })

    it('should detect blank json schema values', () => {
      expect(isJsonSchemaEmpty(undefined)).toBe(true)
      expect(isJsonSchemaEmpty('   ')).toBe(true)
      expect(isJsonSchemaEmpty('{}')).toBe(false)
      expect(isJsonSchemaEmpty({ type: 'object' } as never)).toBe(false)
      expect(isStringInputType(InputVarType.textInput)).toBe(true)
      expect(isStringInputType(InputVarType.paragraph)).toBe(true)
      expect(isStringInputType(InputVarType.number)).toBe(false)
    })
  })

  describe('validation', () => {
    it.each([InputVarType.singleFile, InputVarType.multiFiles])(
      'should save uploaded %s defaults as JSON without changing the uploader file',
      async (type) => {
        const originalFile = new File(['document'], 'document.txt', { type: 'text/plain' })
        const uploadedMetadata: FileEntity = {
          id: 'local-file',
          name: 'document.txt',
          size: originalFile.size,
          type: originalFile.type,
          progress: 100,
          transferMethod: 'local_file',
          supportFileType: 'document',
          uploadedId: 'uploaded-file-id',
        }
        const uploadedFile = { ...uploadedMetadata, originalFile }
        const remoteFile: FileEntity = {
          ...uploadedMetadata,
          id: 'remote-file',
          transferMethod: 'remote_url',
          url: 'https://example.com/document.txt',
        }
        const tempPayload = createInputVar({
          type,
          allowed_file_types: [SupportUploadFileTypes.document],
          default: type === InputVarType.singleFile ? uploadedFile : [uploadedFile, remoteFile],
        })
        const { payloadToSave } = validateConfigModalPayload({ tempPayload, t })
        expect(payloadToSave).toBeDefined()

        const requests: Request[] = []
        const client = createORPCClient<ContractRouterClient<typeof contract>>(
          new OpenAPILink(contract, {
            url: 'https://example.com/console/api',
            fetch: async (request) => {
              requests.push(request)
              return new Response(
                JSON.stringify({ result: 'success', hash: 'saved', updated_at: 1 }),
                {
                  headers: { 'content-type': 'application/json' },
                },
              )
            },
          }),
        )
        await client.apps.byAppId.workflows.draft.post({
          params: { app_id: 'app-id' },
          body: {
            graph: {
              nodes: [{ id: 'start', data: { type: 'start', variables: [payloadToSave] } }],
              edges: [],
            },
            features: {},
          },
        })

        const request = requests[0]!
        expect(request.headers.get('content-type')).toBe('application/json')
        const body = await request.json()
        expect(body.graph.nodes[0].data.variables[0].default).toEqual(
          type === InputVarType.singleFile ? uploadedMetadata : [uploadedMetadata, remoteFile],
        )
        expect(uploadedFile.originalFile).toBe(originalFile)
        expect(await uploadedFile.originalFile.text()).toBe('document')
      },
    )

    it('should remove upload binaries when a file input changes to text before saving', () => {
      const originalFile = new File(['document'], 'document.txt', { type: 'text/plain' })
      const uploadedMetadata: FileEntity = {
        id: 'local-file',
        name: 'document.txt',
        size: originalFile.size,
        type: originalFile.type,
        progress: 100,
        transferMethod: 'local_file',
        supportFileType: 'document',
        uploadedId: 'uploaded-file-id',
      }
      const filePayload = createInputVar({
        type: InputVarType.singleFile,
        default: { ...uploadedMetadata, originalFile },
      })
      const tempPayload = createPayloadForType(filePayload, InputVarType.textInput)

      const { payloadToSave } = validateConfigModalPayload({ tempPayload, t })

      expect(payloadToSave?.type).toBe(InputVarType.textInput)
      expect(payloadToSave?.default).toEqual(uploadedMetadata)
      expect(filePayload.default).toEqual({ ...uploadedMetadata, originalFile })
    })

    it.each([
      '{"originalFile":"document.txt","count":2}',
      '[null,{"originalFile":"document.txt"}]',
    ])('should preserve JSON default data: %s', (json) => {
      const defaultValue = JSON.parse(json)
      const { payloadToSave } = validateConfigModalPayload({
        tempPayload: createInputVar({ type: InputVarType.jsonObject, default: defaultValue }),
        t,
      })

      expect(payloadToSave?.default).toEqual(defaultValue)
    })

    it.each([
      { type: InputVarType.singleFile, defaultValue: undefined },
      { type: InputVarType.singleFile, defaultValue: '' },
      { type: InputVarType.multiFiles, defaultValue: undefined },
      { type: InputVarType.multiFiles, defaultValue: [] },
    ])('should preserve an empty $type default', ({ type, defaultValue }) => {
      const { payloadToSave } = validateConfigModalPayload({
        tempPayload: createInputVar({
          type,
          default: defaultValue,
          allowed_file_types: [SupportUploadFileTypes.document],
        }),
        t,
      })

      expect(payloadToSave?.default).toEqual(defaultValue)
    })

    it('should reject duplicate select options', () => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.select,
          options: ['alpha', 'alpha'],
        }),
        payload: createInputVar({
          variable: 'question',
        }),
        t,
      })

      expect(result.errorMessage).toBe('variableConfig.errorMsg.optionRepeat')
    })

    it('should require custom extensions when custom file types are enabled', () => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.singleFile,
          allowed_file_types: [SupportUploadFileTypes.custom],
          allowed_file_extensions: [],
        }),
        payload: createInputVar(),
        t,
      })

      expect(result.errorMessage).toBe('errorMsg.fieldRequired')
    })

    it('should require at least one select option and supported file types', () => {
      const selectResult = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.select,
          options: [],
        }),
        payload: createInputVar(),
        t,
      })

      const fileResult = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.singleFile,
          allowed_file_types: [],
        }),
        payload: createInputVar(),
        t,
      })

      expect(selectResult.errorMessage).toBe('variableConfig.errorMsg.atLeastOneOption')
      expect(fileResult.errorMessage).toBe('errorMsg.fieldRequired')
    })

    it('should reject invalid json schema definitions', () => {
      const invalidResult = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.jsonObject,
          json_schema: '{',
        }),
        payload: createInputVar(),
        t,
      })

      const nonObjectResult = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.jsonObject,
          json_schema: JSON.stringify({ type: 'string' }),
        }),
        payload: createInputVar(),
        t,
      })

      expect(invalidResult.errorMessage).toBe('variableConfig.errorMsg.jsonSchemaInvalid')
      expect(nonObjectResult.errorMessage).toBe('variableConfig.errorMsg.jsonSchemaMustBeObject')
    })

    it('should normalize blank json schema and return rename metadata', () => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.jsonObject,
          variable: 'question_new',
          json_schema: '   ',
        }),
        payload: createInputVar({
          variable: 'question_old',
        }),
        t,
      })

      expect(result.errorMessage).toBeUndefined()
      expect(result.payloadToSave).toEqual(
        expect.objectContaining({
          json_schema: undefined,
          variable: 'question_new',
        }),
      )
      expect(result.moreInfo).toEqual({
        type: ChangeType.changeVarName,
        payload: {
          beforeKey: 'question_old',
          afterKey: 'question_new',
        },
      })
    })

    it.each([
      [Number.NaN, 1],
      [undefined, 1],
      [0, 1],
      [5, 3],
      [2, 2],
    ])('should normalize multi-file count %s to %s at submission', (count, expected) => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.multiFiles,
          max_length: count,
          allowed_file_types: [SupportUploadFileTypes.document],
        }),
        maxFileUploadLimit: 3,
        t,
      })

      expect(result.payloadToSave?.max_length).toBe(expected)
    })

    it('should preserve an existing upload count while the server limit is unavailable', () => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.multiFiles,
          max_length: 20,
          allowed_file_types: [SupportUploadFileTypes.document],
        }),
        t,
      })

      expect(result.payloadToSave?.max_length).toBe(20)
    })

    it('should force file inputs to stay visible when saving', () => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          type: InputVarType.singleFile,
          hide: true,
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_extensions: [],
        }),
        payload: createInputVar(),
        t,
      })

      expect(result.payloadToSave).toEqual(
        expect.objectContaining({
          hide: false,
        }),
      )
    })

    it('should associate invalid variable names with the variable field', () => {
      const result = validateConfigModalPayload({
        tempPayload: createInputVar({
          variable: 'invalid-name!',
        }),
        payload: createInputVar({
          variable: 'question',
        }),
        t,
      })

      expect(result.errorField).toBe('variable')
      expect(result.errorMessage).toBeTruthy()
      expect(result.payloadToSave).toBeUndefined()
    })
  })
})
