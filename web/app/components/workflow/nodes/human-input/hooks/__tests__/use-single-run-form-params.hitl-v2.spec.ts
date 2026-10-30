import type { ReactNode } from 'react'
import type { HumanInputV2NodeType } from '../../../human-input-v2/types'
import type { HumanInputNodeType } from '../../types'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import {
  act,
  render as rtlRender,
  renderHook as rtlRenderHook,
  screen,
} from '@testing-library/react'
import { createElement, StrictMode, useEffect, useRef } from 'react'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { withSelectorKey } from '@/test/i18n-mock'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockFetchHumanInputNodeStepRunForm = vi.hoisted(() => vi.fn())
const mockSubmitHumanInputNodeStepRunForm = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({ toast: { error: mockToastError } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

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

function createWrapper() {
  const { wrapper: QueryWrapper } = createConsoleQueryWrapper()
  return ({ children }: { children: ReactNode }) =>
    createElement(
      QueryWrapper,
      null,
      createElement(EditorResourceScope, {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
        children,
      }),
    )
}

const renderHook = <T>(callback: () => T) => rtlRenderHook(callback, { wrapper: createWrapper() })

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: createWrapper() })

describe('human-input/hooks/use-single-run-form-params', () => {
  const mockSetRunInputData = vi.fn()
  const getInputVars = vi.fn()
  let currentInputs = createPayload()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncDraft.mockResolvedValue({})
    currentInputs = createPayload()

    mockUseTranslation.mockReturnValue({
      t: withSelectorKey((key: string) => key),
    })

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

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.preview.post': (input: {
        params: { app_id: string; node_id: string }
        body: unknown
      }) =>
        mockFetchHumanInputNodeStepRunForm(
          `/apps/${input.params.app_id}/workflows/draft/human-input/nodes/${
            input.params.node_id
          }/form`,
          input.body,
        ),
      'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.run.post': (input: {
        params: { app_id: string; node_id: string }
        body: unknown
      }) =>
        mockSubmitHumanInputNodeStepRunForm(
          `/apps/${input.params.app_id}/workflows/draft/human-input/nodes/${
            input.params.node_id
          }/form`,
          input.body,
        ),
    }),
  }
})
