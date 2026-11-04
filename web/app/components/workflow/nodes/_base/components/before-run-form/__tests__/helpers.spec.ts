import type { TFunction } from 'i18next'
import type { InputVar } from '@/app/components/workflow/types'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import { TransferMethod } from '@/types/app'
import {
  buildSubmitData,
  formatValue,
  getFormErrorMessage,
  isFilesLoaded,
  shouldAutoRunBeforeRunForm,
  shouldAutoShowGeneratedForm,
} from '../helpers'

type FormArg = Parameters<typeof buildSubmitData>[0][number]

describe('before-run-form helpers', () => {
  const createValues = (values: Record<string, unknown>) => values as Record<string, string>
  const createInput = (input: Partial<InputVar>): InputVar => ({
    variable: 'field',
    label: 'Field',
    type: InputVarType.textInput,
    required: false,
    ...input,
  })
  const createForm = (form: Partial<FormArg>): FormArg =>
    ({
      inputs: [],
      values: createValues({}),
      onChange: vi.fn(),
      ...form,
    }) as FormArg

  it('should format values by input type', () => {
    expect(formatValue('12.5', InputVarType.number)).toBe(12.5)
    expect(formatValue('{"foo":1}', InputVarType.json)).toEqual({ foo: 1 })
    expect(formatValue('', InputVarType.checkbox)).toBe(false)
    expect(formatValue(['{"foo":1}'], InputVarType.contexts)).toEqual([{ foo: 1 }])
    expect(formatValue(null, InputVarType.singleFile)).toBeNull()
    expect(
      formatValue(
        [
          {
            transferMethod: TransferMethod.remote_url,
            supportFileType: 'image',
            url: 'https://example.com/image.png',
            progress: 100,
          },
        ],
        InputVarType.singleFile,
      ),
    ).toEqual([
      {
        type: 'image',
        transfer_method: TransferMethod.remote_url,
        url: 'https://example.com/image.png',
        upload_file_id: '',
      },
    ])
    expect(formatValue('', InputVarType.singleFile)).toBeUndefined()
  })

  it('should detect when file uploads are still in progress', () => {
    expect(isFilesLoaded([])).toBe(true)
    expect(isFilesLoaded([createForm({ inputs: [], values: {} })])).toBe(true)
    expect(
      isFilesLoaded([
        createForm({
          inputs: [],
          values: createValues({
            '#files#': [{ transfer_method: TransferMethod.local_file }],
          }),
        }),
      ]),
    ).toBe(false)
  })

  it('should report required and uploading file errors', () => {
    const t = withSelectorKey(
      (key: string, options?: Record<string, unknown>) => `${key}:${options?.field ?? ''}`,
    ) as TFunction<['appDebug', 'workflow']>

    expect(
      getFormErrorMessage(
        [
          createForm({
            inputs: [createInput({ variable: 'query', label: 'Query', required: true })],
            values: createValues({ query: '' }),
          }),
        ],
        [{}],
        t,
      ),
    ).toContain('errorMsg.fieldRequired')

    expect(
      getFormErrorMessage(
        [
          createForm({
            inputs: [
              createInput({
                variable: 'file',
                label: 'File',
                type: InputVarType.singleFile,
                required: true,
              }),
            ],
            values: createValues({ file: [] }),
          }),
        ],
        [{}],
        t,
      ),
    ).toContain('errorMsg.fieldRequired')

    expect(
      getFormErrorMessage(
        [
          createForm({
            inputs: [
              createInput({
                variable: 'files',
                label: 'Files',
                type: InputVarType.multiFiles,
                required: true,
              }),
            ],
            values: createValues({ files: [] }),
          }),
        ],
        [{}],
        t,
      ),
    ).toContain('errorMsg.fieldRequired')

    expect(
      getFormErrorMessage(
        [
          createForm({
            inputs: [
              createInput({ variable: 'file', label: 'File', type: InputVarType.singleFile }),
            ],
            values: createValues({ file: { transferMethod: TransferMethod.local_file } }),
          }),
        ],
        [{}],
        t,
      ),
    ).toContain('errorMessage.waitForFileUpload')

    expect(
      getFormErrorMessage(
        [
          createForm({
            inputs: [
              createInput({ variable: 'files', label: 'Files', type: InputVarType.multiFiles }),
            ],
            values: createValues({ files: [{ transferMethod: TransferMethod.local_file }] }),
          }),
        ],
        [{}],
        t,
      ),
    ).toContain('errorMessage.waitForFileUpload')

    expect(
      getFormErrorMessage(
        [
          createForm({
            inputs: [
              createInput({
                variable: 'config',
                label: { nodeType: BlockEnum.Tool, nodeName: 'Tool', variable: 'Config' },
                required: true,
              }),
            ],
            values: createValues({ config: '' }),
          }),
        ],
        [{}],
        t,
      ),
    ).toContain('Config')
  })

  it('should build submit data and keep parse errors', () => {
    expect(
      buildSubmitData([
        createForm({
          inputs: [createInput({ variable: 'query' })],
          values: createValues({ query: 'hello' }),
        }),
      ]),
    ).toEqual({
      submitData: { query: 'hello' },
      parseErrorJsonField: '',
    })

    expect(
      buildSubmitData([
        createForm({
          inputs: [createInput({ variable: 'payload', type: InputVarType.json })],
          values: createValues({ payload: '{' }),
        }),
      ]).parseErrorJsonField,
    ).toBe('payload')

    expect(
      buildSubmitData([
        createForm({
          inputs: [
            createInput({ variable: 'files', type: InputVarType.multiFiles }),
            createInput({ variable: 'file', type: InputVarType.singleFile }),
          ],
          values: createValues({
            files: [
              {
                transferMethod: TransferMethod.remote_url,
                supportFileType: 'document',
                url: 'https://example.com/report.pdf',
                progress: 100,
              },
            ],
            file: {
              transferMethod: TransferMethod.local_file,
              supportFileType: 'image',
              uploadedId: 'upload-2',
              progress: 100,
            },
          }),
        }),
      ]).submitData,
    ).toEqual({
      files: [
        {
          type: 'document',
          transfer_method: TransferMethod.remote_url,
          url: 'https://example.com/report.pdf',
          upload_file_id: '',
        },
      ],
      file: {
        type: 'image',
        transfer_method: TransferMethod.local_file,
        url: '',
        upload_file_id: 'upload-2',
      },
    })
  })

  it('should derive the zero-form auto behaviors', () => {
    expect(shouldAutoRunBeforeRunForm([], false)).toBe(true)
    expect(shouldAutoRunBeforeRunForm([], true)).toBe(false)
    expect(shouldAutoShowGeneratedForm([], true)).toBe(true)
    expect(shouldAutoShowGeneratedForm([createForm({})], true)).toBe(false)
  })
})
