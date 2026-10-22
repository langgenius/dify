import type { HumanInputFormPreviewResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { HumanInputNodeType } from '../../types'
import type { WorkflowAppMode } from '@/app/components/apps/app-type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { act } from '@testing-library/react'
import { renderWorkflowFlowHook as renderHookWithConsoleQuery } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { TransferMethod } from '@/types/app'
import useSingleRunFormParams from '../use-single-run-form-params'

const previewForm = vi.hoisted(() => vi.fn())
const request = vi.hoisted(() => vi.fn<typeof import('@/service/base').request>())
vi.mock('@/service/base', () => ({ request }))

const createPayload = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [],
  form_content: 'Summary: {{#start.topic#}}',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'summary',
      default: {
        type: 'variable',
        selector: ['start', 'topic'],
        value: '',
      },
    },
  ],
  user_actions: [],
  timeout: 1,
  timeout_unit: 'day',
  ...overrides,
})

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: 'Topic',
  variable: '#start.topic#',
  required: false,
  value_selector: ['start', 'topic'],
  ...overrides,
})

const mockFormData: HumanInputFormData = {
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Human Input',
  form_content: 'Rendered content',
  inputs: [],
  actions: [],
  form_token: 'token-1',
  resolved_default_values: {
    topic: 'AI',
  },
  display_in_ui: true,
  expiration_time: 1000,
}

describe('human-input/hooks/use-single-run-form-params', () => {
  const mockSetRunInputData = vi.fn()
  const getInputVars = vi.fn()
  let currentInputs = createPayload()
  let appDetail: { id: string; mode: WorkflowAppMode } | undefined

  const renderHook = <Result>(callback: () => Result) => {
    const queryClient = createConsoleQueryClient()
    if (appDetail) seedAppDetail(queryClient, createAppDetailFixture(appDetail))
    return renderHookWithConsoleQuery(callback, {
      queryClient,
      resource: {
        kind: 'app',
        appId: appDetail?.id ?? 'app-1',
        mode: appDetail?.mode ?? 'workflow',
      },
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()
    appDetail = {
      id: 'app-1',
      mode: 'workflow' as const,
    }

    getInputVars.mockReturnValue([
      createInputVar(),
      createInputVar({
        label: 'Output',
        variable: '#$output.answer#',
        value_selector: ['$output', 'answer'],
      }),
      {
        ...createInputVar({
          label: 'Broken',
        }),
        variable: undefined,
      } as unknown as InputVar,
    ])
    previewForm.mockResolvedValue(mockFormData)
    request.mockReset().mockImplementation(async (url, _init, options) => {
      if (new URL(url).pathname.endsWith('/form/preview')) {
        return Response.json(
          await previewForm(new URL(url).pathname, await options?.request?.json()),
        )
      }
      return Response.json({})
    })
  })

  const uploadedFile: FileEntity = {
    id: 'file-1',
    name: 'decision.pdf',
    size: 128,
    type: 'application/pdf',
    progress: 100,
    transferMethod: TransferMethod.local_file,
    supportFileType: 'document',
    uploadedId: 'upload-file-1',
  }

  const remoteFile: FileEntity = {
    id: 'file-2',
    name: 'reference.pdf',
    size: 256,
    type: 'application/pdf',
    progress: 100,
    transferMethod: TransferMethod.remote_url,
    supportFileType: 'document',
    url: 'https://example.com/reference.pdf',
  }

  it('should build a single before-run form, filter output vars, and expose dependent vars', () => {
    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'node-1',
        payload: currentInputs,
        runInputData: { topic: 'AI' },
        getInputVars,
        setRunInputData: mockSetRunInputData,
      }),
    )

    expect(getInputVars).toHaveBeenCalledWith(['{{#start.topic#}}', 'Summary: {{#start.topic#}}'])
    expect(result.current.forms).toHaveLength(1)
    expect(result.current.forms[0]).toEqual(
      expect.objectContaining({
        label: 'workflowHumanInput.nodes.humanInput.singleRun.label',
        values: { topic: 'AI' },
        inputs: [
          expect.objectContaining({ variable: '#start.topic#' }),
          expect.objectContaining({ label: 'Broken' }),
        ],
      }),
    )

    act(() => {
      result.current.forms[0]!.onChange?.({ topic: 'Updated' })
    })

    expect(mockSetRunInputData).toHaveBeenCalledWith({ topic: 'Updated' })
    expect(result.current.getDependentVars()).toEqual([['start', 'topic']])
  })

  it('should include variables referenced by dynamic select option sources', () => {
    currentInputs = createPayload({
      inputs: [
        {
          type: InputVarType.paragraph,
          output_variable_name: 'summary',
          default: {
            type: 'variable',
            selector: ['start', 'topic'],
            value: '',
          },
        },
        {
          type: InputVarType.select,
          output_variable_name: 'choice',
          option_source: {
            type: 'variable',
            selector: ['start', 'choices'],
            value: [],
          },
        },
      ],
    })
    getInputVars.mockReturnValue([
      createInputVar(),
      createInputVar({
        label: 'Choices',
        variable: '#start.choices#',
        value_selector: ['start', 'choices'],
      }),
    ])

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'node-1',
        payload: currentInputs,
        runInputData: {},
        getInputVars,
        setRunInputData: mockSetRunInputData,
      }),
    )

    expect(getInputVars).toHaveBeenCalledWith([
      '{{#start.topic#}}',
      '{{#start.choices#}}',
      'Summary: {{#start.topic#}}',
    ])
    expect(result.current.forms[0]!.inputs).toEqual([
      expect.objectContaining({ variable: '#start.topic#' }),
      expect.objectContaining({ variable: '#start.choices#' }),
    ])
    expect(result.current.getDependentVars()).toEqual([
      ['start', 'topic'],
      ['start', 'choices'],
    ])
  })

  it('should fetch and submit generated forms in workflow mode while keeping required inputs', async () => {
    const formDataWithFiles = {
      ...mockFormData,
      inputs: [
        {
          type: InputVarType.paragraph,
          output_variable_name: 'answer',
          default: {
            type: 'constant',
            selector: [],
            value: '',
          },
        },
        {
          type: InputVarType.singleFile,
          output_variable_name: 'attachment',
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        },
        {
          type: InputVarType.multiFiles,
          output_variable_name: 'references',
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
          number_limits: 3,
        },
      ],
    } satisfies HumanInputFormData
    previewForm.mockResolvedValue(formDataWithFiles)

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'node-1',
        payload: currentInputs,
        runInputData: {},
        getInputVars,
        setRunInputData: mockSetRunInputData,
      }),
    )

    const previewInputs = Object.freeze({ topic: 'AI', ignored: undefined as unknown as string })
    await act(async () => {
      await result.current.handleShowGeneratedForm(previewInputs)
    })
    expect(previewInputs).toHaveProperty('ignored', undefined)

    expect(result.current.showGeneratedForm).toBe(true)
    expect(previewForm).toHaveBeenCalledWith(
      '/console/api/apps/app-1/workflows/draft/human-input/nodes/node-1/form/preview',
      {
        inputs: { topic: 'AI' },
      },
    )
    expect(result.current.formData).toEqual(formDataWithFiles)

    await act(async () => {
      await result.current.handleSubmitHumanInputForm({
        inputs: {
          answer: 'approved',
          attachment: uploadedFile,
          references: [uploadedFile, remoteFile],
        },
        form_inputs: { ignored: 'value' },
        action: 'approve',
      })
    })

    expect(new URL(request.mock.calls[1]![0]).pathname).toBe(
      '/console/api/apps/app-1/workflows/draft/human-input/nodes/node-1/form/run',
    )
    expect(request.mock.calls[1]?.[2]?.request?.method).toBe('POST')
    expect(await request.mock.calls[1]?.[2]?.request?.json()).toEqual({
      inputs: { topic: 'AI' },
      form_inputs: {
        answer: 'approved',
        attachment: {
          type: 'document',
          transfer_method: TransferMethod.local_file,
          url: '',
          upload_file_id: 'upload-file-1',
        },
        references: [
          {
            type: 'document',
            transfer_method: TransferMethod.local_file,
            url: '',
            upload_file_id: 'upload-file-1',
          },
          {
            type: 'document',
            transfer_method: TransferMethod.remote_url,
            url: 'https://example.com/reference.pdf',
            upload_file_id: '',
          },
        ],
      },
      action: 'approve',
    })

    act(() => {
      result.current.handleHideGeneratedForm()
    })

    expect(result.current.showGeneratedForm).toBe(false)
  })

  it('should use the advanced-chat endpoint for chatflow form previews', async () => {
    appDetail = {
      id: 'app-2',
      mode: 'advanced-chat' as const,
    }

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'node-9',
        payload: currentInputs,
        runInputData: {},
        getInputVars,
        setRunInputData: mockSetRunInputData,
      }),
    )

    await act(async () => {
      await result.current.handleFetchFormContent({ topic: 'hello' })
    })

    expect(previewForm).toHaveBeenCalledWith(
      '/console/api/apps/app-2/advanced-chat/workflows/draft/human-input/nodes/node-9/form/preview',
      {
        inputs: { topic: 'hello' },
      },
    )

    expect(previewForm).toHaveBeenCalledTimes(1)
    await act(async () => {
      await result.current.handleSubmitHumanInputForm({
        inputs: undefined,
        form_inputs: undefined,
        action: 'approve',
      })
    })
    expect(new URL(request.mock.calls[1]![0]).pathname).toBe(
      '/console/api/apps/app-2/advanced-chat/workflows/draft/human-input/nodes/node-9/form/run',
    )
    expect(await request.mock.calls[1]?.[2]?.request?.json()).toEqual({
      inputs: { topic: 'hello' },
      form_inputs: {},
      action: 'approve',
    })
  })

  it('should normalize optional field settings without losing empty defaults or zero limits', async () => {
    previewForm.mockResolvedValue({
      form_id: 'preview',
      node_id: 'node-1',
      node_title: 'Human Input',
      form_content: '{{#$output.answer#}}',
      inputs: [
        { type: 'paragraph', output_variable_name: 'answer', default: null },
        {
          type: 'paragraph',
          output_variable_name: 'topic',
          default: { type: 'variable', selector: ['start', 'topic'], value: '' },
        },
        {
          type: 'select',
          output_variable_name: 'choice',
          option_source: { type: 'constant', value: [] },
        },
        { type: 'file', output_variable_name: 'attachment' },
        { type: 'file-list', output_variable_name: 'attachments', number_limits: 0 },
      ],
      actions: [{ id: 'approve', title: 'Approve' }],
      resolved_default_values: { topic: '' },
      display_in_ui: false,
      expiration_time: 0,
    } satisfies HumanInputFormPreviewResponse)

    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'node-1',
        payload: currentInputs,
        runInputData: {},
        getInputVars,
        setRunInputData: mockSetRunInputData,
      }),
    )

    await act(async () => {
      await result.current.handleFetchFormContent({})
    })

    expect(result.current.formData).toMatchObject({
      inputs: [
        { type: 'paragraph', default: { type: 'constant', selector: [], value: '' } },
        {
          type: 'paragraph',
          default: { type: 'variable', selector: ['start', 'topic'], value: '' },
        },
        { type: 'select', option_source: { type: 'constant', selector: [], value: [] } },
        {
          type: 'file',
          allowed_file_types: [],
          allowed_file_extensions: [],
          allowed_file_upload_methods: [],
        },
        {
          type: 'file-list',
          allowed_file_types: [],
          allowed_file_extensions: [],
          allowed_file_upload_methods: [],
          number_limits: 0,
        },
      ],
      actions: [{ id: 'approve', title: 'Approve', button_style: 'default' }],
      resolved_default_values: { topic: '' },
      form_token: null,
      display_in_ui: false,
      expiration_time: 0,
    })
  })
})
