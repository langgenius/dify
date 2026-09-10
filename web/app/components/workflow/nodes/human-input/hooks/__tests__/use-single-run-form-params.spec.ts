import type { HumanInputV2NodeType } from '../../../human-input-v2/types'
import type { HumanInputNodeType } from '../../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { act, render, renderHook, screen } from '@testing-library/react'
import { createElement, StrictMode, useEffect, useRef } from 'react'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import { AppModeEnum, TransferMethod } from '@/types/app'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseAppStore = vi.hoisted(() => vi.fn())
const mockFetchHumanInputNodeStepRunForm = vi.hoisted(() => vi.fn())
const mockSubmitHumanInputNodeStepRunForm = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('@langgenius/dify-ui/toast', () => ({ toast: { error: mockToastError } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: { appDetail?: { id?: string; mode?: AppModeEnum } }) => unknown) =>
    mockUseAppStore(selector),
}))

vi.mock('@/service/client', () => {
  const form = {
    preview: {
      post: ({
        params,
        body,
      }: {
        params: { app_id: string; node_id: string }
        body: { inputs: unknown }
      }) =>
        mockFetchHumanInputNodeStepRunForm(
          `/apps/${params.app_id}/workflows/draft/human-input/nodes/${params.node_id}/form`,
          body,
        ),
    },
    run: {
      post: ({ params, body }: { params: { app_id: string; node_id: string }; body: unknown }) =>
        mockSubmitHumanInputNodeStepRunForm(
          `/apps/${params.app_id}/workflows/draft/human-input/nodes/${params.node_id}/form`,
          body,
        ),
    },
  }
  const chatForm = {
    preview: {
      post: ({ params, body }: { params: { app_id: string; node_id: string }; body: unknown }) =>
        mockFetchHumanInputNodeStepRunForm(
          `/apps/${params.app_id}/advanced-chat/workflows/draft/human-input/nodes/${params.node_id}/form`,
          body,
        ),
    },
    run: {
      post: ({ params, body }: { params: { app_id: string; node_id: string }; body: unknown }) =>
        mockSubmitHumanInputNodeStepRunForm(
          `/apps/${params.app_id}/advanced-chat/workflows/draft/human-input/nodes/${params.node_id}/form`,
          body,
        ),
    },
  }
  return {
    consoleClient: {
      apps: {
        byAppId: {
          workflows: { draft: { humanInput: { nodes: { byNodeId: { form } } } } },
          advancedChat: {
            workflows: { draft: { humanInput: { nodes: { byNodeId: { form: chatForm } } } } },
          },
        },
      },
    },
  }
})
const mockSyncDraft = vi.hoisted(() => vi.fn())
vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ doSyncWorkflowDraft: mockSyncDraft }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

const createPayload = (
  overrides: Partial<HumanInputNodeType & Pick<HumanInputV2NodeType, 'version'>> = {},
): HumanInputNodeType & Partial<Pick<HumanInputV2NodeType, 'version'>> => ({
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
  let appDetail: { id?: string; mode?: AppModeEnum } | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncDraft.mockResolvedValue({})
    currentInputs = createPayload()
    appDetail = {
      id: 'app-1',
      mode: AppModeEnum.WORKFLOW,
    }

    mockUseTranslation.mockReturnValue({
      t: withSelectorKey((key: string) => key),
    })
    mockUseAppStore.mockImplementation(
      (selector: (state: { appDetail?: { id?: string; mode?: AppModeEnum } }) => unknown) =>
        selector({ appDetail }),
    )
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
    }))
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
    mockFetchHumanInputNodeStepRunForm.mockResolvedValue(mockFormData)
    mockSubmitHumanInputNodeStepRunForm.mockResolvedValue({})
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
        label: 'nodes.humanInput.singleRun.label',
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
    mockFetchHumanInputNodeStepRunForm.mockResolvedValue(formDataWithFiles)

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
      await result.current.handleShowGeneratedForm({
        topic: 'AI',
        ignored: undefined as unknown as string,
      })
    })

    expect(result.current.showGeneratedForm).toBe(true)
    expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledWith(
      '/apps/app-1/workflows/draft/human-input/nodes/node-1/form',
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

    expect(mockSubmitHumanInputNodeStepRunForm).toHaveBeenCalledWith(
      '/apps/app-1/workflows/draft/human-input/nodes/node-1/form',
      {
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
      },
    )

    act(() => {
      result.current.handleHideGeneratedForm()
    })

    expect(result.current.showGeneratedForm).toBe(false)
  })

  it('should use the advanced-chat endpoint and skip remote fetches when app detail is missing', async () => {
    appDetail = {
      id: 'app-2',
      mode: AppModeEnum.ADVANCED_CHAT,
    }

    const { result, rerender } = renderHook(() =>
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

    expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledWith(
      '/apps/app-2/advanced-chat/workflows/draft/human-input/nodes/node-9/form',
      {
        inputs: { topic: 'hello' },
      },
    )

    appDetail = undefined
    rerender()

    await act(async () => {
      const data = await result.current.handleFetchFormContent({ topic: 'skip' })
      expect(data).toBeNull()
    })

    expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledTimes(1)
  })
  it('waits for the V2 draft save before requesting the authoritative form', async () => {
    currentInputs = createPayload({ version: '2' })
    let resolveSave!: (value: object) => void
    mockSyncDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    const { result } = renderHook(() =>
      useSingleRunFormParams({
        id: 'node-1',
        payload: currentInputs,
        runInputData: {},
        getInputVars,
        setRunInputData: mockSetRunInputData,
      }),
    )
    let request!: Promise<void>
    act(() => {
      request = result.current.handleShowGeneratedForm({ topic: 'saved' })
    })
    expect(result.current.isGeneratingForm).toBe(true)
    expect(mockFetchHumanInputNodeStepRunForm).not.toHaveBeenCalled()
    await act(async () => {
      resolveSave({})
      await request
    })
    expect(result.current.showGeneratedForm).toBe(true)
    expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledOnce()
  })

  it('does not test stale V2 data when the draft save is skipped', async () => {
    currentInputs = createPayload({ version: '2' })
    mockSyncDraft.mockResolvedValue(null)
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
      await result.current.handleShowGeneratedForm({})
    })
    expect(mockFetchHumanInputNodeStepRunForm).not.toHaveBeenCalled()
    expect(result.current.showGeneratedForm).toBe(false)
    expect(result.current.isGeneratingForm).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('nodes.humanInputV2.template.testSaveFailed')
  })

  it('keeps the input screen available after a failed preview and allows retry', async () => {
    mockFetchHumanInputNodeStepRunForm.mockRejectedValueOnce(new Error('Preview unavailable'))
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
      await result.current.handleShowGeneratedForm({})
    })
    expect(result.current.showGeneratedForm).toBe(false)
    expect(result.current.isGeneratingForm).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('Preview unavailable')
    await act(async () => {
      await result.current.handleShowGeneratedForm({})
    })
    expect(result.current.showGeneratedForm).toBe(true)
  })

  it('normalizes nullable server defaults and rejects malformed response fields', async () => {
    mockFetchHumanInputNodeStepRunForm.mockResolvedValueOnce({
      ...mockFormData,
      inputs: [{ type: 'paragraph', output_variable_name: 'answer', default: null }],
    })
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
      await result.current.handleShowGeneratedForm({})
    })
    expect(result.current.formData?.inputs).toEqual([
      {
        type: InputVarType.paragraph,
        output_variable_name: 'answer',
        default: { type: 'constant', value: '', selector: [] },
      },
    ])
    act(() => {
      result.current.handleHideGeneratedForm()
    })
    mockFetchHumanInputNodeStepRunForm.mockResolvedValueOnce({
      ...mockFormData,
      inputs: [{ type: 'unknown' }],
    })
    await act(async () => {
      await result.current.handleShowGeneratedForm({})
    })
    expect(result.current.showGeneratedForm).toBe(false)
    expect(result.current.isGeneratingForm).toBe(false)
  })
  it.each([undefined, '2'] as const)(
    'automatically generates the V%s form when the child mounts in StrictMode',
    async (version) => {
      currentInputs = createPayload({ version })
      const AutoGenerate = ({ form }: { form: ReturnType<typeof useSingleRunFormParams> }) => {
        const hasRunRef = useRef(false)
        const { handleShowGeneratedForm } = form
        useEffect(() => {
          if (hasRunRef.current) return
          hasRunRef.current = true
          void handleShowGeneratedForm({})
        }, [handleShowGeneratedForm])
        return createElement(
          'div',
          null,
          form.showGeneratedForm ? form.formData?.form_content : 'pending',
        )
      }
      const Panel = ({ open }: { open: boolean }) => {
        const form = useSingleRunFormParams({
          id: 'node-1',
          payload: { ...currentInputs, _isSingleRun: open },
          runInputData: {},
          getInputVars,
          setRunInputData: mockSetRunInputData,
        })
        return open ? createElement(AutoGenerate, { form }) : null
      }
      const { rerender } = render(
        createElement(StrictMode, null, createElement(Panel, { open: false })),
      )
      rerender(createElement(StrictMode, null, createElement(Panel, { open: true })))
      expect(await screen.findByText('Rendered content')).toBeInTheDocument()
      expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledOnce()
      rerender(createElement(StrictMode, null, createElement(Panel, { open: false })))
      rerender(createElement(StrictMode, null, createElement(Panel, { open: true })))
      expect(await screen.findByText('Rendered content')).toBeInTheDocument()
      expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledTimes(2)
    },
  )

  it('ignores an old form response after the single-run session closes and reopens', async () => {
    currentInputs = createPayload({ _isSingleRun: true })
    let resolveOld!: (value: HumanInputFormData) => void
    mockFetchHumanInputNodeStepRunForm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const { result, rerender } = renderHook(() =>
      useSingleRunFormParams({
        id: 'node-1',
        payload: currentInputs,
        runInputData: {},
        getInputVars,
        setRunInputData: mockSetRunInputData,
      }),
    )
    let oldRequest!: Promise<void>
    act(() => {
      oldRequest = result.current.handleShowGeneratedForm({ topic: 'old' })
    })
    currentInputs = createPayload({ _isSingleRun: false })
    rerender()
    currentInputs = createPayload({ _isSingleRun: true })
    rerender()
    await act(async () => {
      await result.current.handleShowGeneratedForm({ topic: 'new' })
    })
    await act(async () => {
      resolveOld({ ...mockFormData, form_content: 'Old response' })
      await oldRequest
    })
    expect(result.current.formData?.form_content).toBe('Rendered content')
    await act(async () => {
      await result.current.handleSubmitHumanInputForm({
        action: 'approve',
        inputs: {},
        form_inputs: {},
      })
    })
    expect(mockSubmitHumanInputNodeStepRunForm).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ inputs: { topic: 'new' } }),
    )
  })
})
