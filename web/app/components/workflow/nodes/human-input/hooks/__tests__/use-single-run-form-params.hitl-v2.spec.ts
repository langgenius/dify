import type { HumanInputV2NodeType } from '../../../human-input-v2/types'
import type { HumanInputNodeType } from '../../types'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store/store'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputFormData } from '@/types/workflow'
import { act, screen, waitFor } from '@testing-library/react'
import { createElement, StrictMode, useEffect, useRef, useState } from 'react'
import { useNodes } from 'reactflow'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import { createNode } from '../../../../__tests__/fixtures'
import {
  renderWorkflowCanvasHook,
  renderWorkflowFlowComponent,
} from '../../../../__tests__/workflow-test-env'
import useSingleRunFormParams from '../use-single-run-form-params'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockFetchHumanInputNodeStepRunForm = vi.hoisted(() => vi.fn())
const mockSubmitHumanInputNodeStepRunForm = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({ toast: { error: mockToastError } }))
vi.mock('react-i18next', () => ({ useTranslation: () => mockUseTranslation() }))

type NodeData = HumanInputNodeType & Partial<Pick<HumanInputV2NodeType, 'version'>>

const createPayload = (overrides: Partial<NodeData> = {}): NodeData => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [],
  form_content: 'Summary: {{#start.topic#}}',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'summary',
      default: { type: 'variable', selector: ['start', 'topic'], value: '' },
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
  resolved_default_values: { topic: 'AI' },
  display_in_ui: true,
  expiration_time: 1000,
}

const getInputVars = vi.fn(() => [
  createInputVar(),
  createInputVar({
    label: 'Output',
    variable: '#$output.answer#',
    value_selector: ['$output', 'answer'],
  }),
])

type SubjectProps = { initialRunInputData?: Record<string, string> }

const renderSubject = (
  payload: NodeData,
  doSyncWorkflowDraft: HooksStoreShape['doSyncWorkflowDraft'] = vi.fn(async () => ({
    hash: 'saved',
    updatedAt: 1,
  })),
  props: SubjectProps = {},
) =>
  renderWorkflowCanvasHook(
    ({ initialRunInputData }: SubjectProps) => {
      const node = useNodes<NodeData>().find(({ id }) => id === 'node-1')!
      const [runInputData, setRunInputData] = useState(initialRunInputData ?? {})
      const form = useSingleRunFormParams({
        id: node.id,
        payload: node.data,
        runInputData,
        getInputVars,
        setRunInputData,
      })
      return { form, runInputData }
    },
    {
      initialProps: props,
      nodes: [createNode({ id: 'node-1', data: payload })],
      hooksStoreProps: { doSyncWorkflowDraft },
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    },
  )

const setSingleRunOpen = (
  subject: Pick<ReturnType<typeof renderSubject>, 'setCanvas'>,
  payload: NodeData,
  open: boolean,
) => {
  act(() =>
    subject.setCanvas({
      nodes: [createNode({ id: 'node-1', data: { ...payload, _isSingleRun: open } })],
    }),
  )
}

describe('human-input/hooks/use-single-run-form-params', () => {
  beforeEach(() => {
    mockUseTranslation.mockReturnValue({ t: withSelectorKey((key: string) => key) })
    mockFetchHumanInputNodeStepRunForm.mockResolvedValue(mockFormData)
    mockSubmitHumanInputNodeStepRunForm.mockResolvedValue({})
  })

  it('waits for the V2 draft save before requesting the authoritative form', async () => {
    const payload = createPayload({ version: '2' })
    let resolveSave!: (value: { hash: string; updatedAt: number }) => void
    const syncDraft = vi.fn(
      () =>
        new Promise<{ hash: string; updatedAt: number }>((resolve) => {
          resolveSave = resolve
        }),
    )
    const subject = renderSubject(payload, syncDraft, {
      initialRunInputData: { topic: 'initial' },
    })

    expect(subject.result.current.form.forms[0]).toMatchObject({
      inputs: [expect.objectContaining({ variable: '#start.topic#' })],
      values: { topic: 'initial' },
    })
    act(() => subject.result.current.form.forms[0]!.onChange({ topic: 'saved' }))
    expect(subject.result.current.runInputData).toEqual({ topic: 'saved' })

    let request!: Promise<void>
    act(() => {
      request = subject.result.current.form.handleShowGeneratedForm(
        subject.result.current.runInputData,
      )
    })
    expect(subject.result.current.form.isGeneratingForm).toBe(true)
    expect(mockFetchHumanInputNodeStepRunForm).not.toHaveBeenCalled()
    await act(async () => {
      resolveSave({ hash: 'saved', updatedAt: 1 })
      await request
    })
    expect(subject.result.current.form.showGeneratedForm).toBe(true)
    expect(subject.result.current.form.formData).toEqual(mockFormData)
    expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledExactlyOnceWith(
      '/apps/app-1/workflows/draft/human-input/nodes/node-1/form',
      { inputs: { topic: 'saved' } },
    )
  })

  it('does not test stale V2 data when the draft save is skipped', async () => {
    const subject = renderSubject(
      createPayload({ version: '2' }),
      vi.fn(async () => null),
    )
    await act(async () => subject.result.current.form.handleShowGeneratedForm({}))
    expect(mockFetchHumanInputNodeStepRunForm).not.toHaveBeenCalled()
    expect(subject.result.current.form.showGeneratedForm).toBe(false)
    expect(subject.result.current.form.isGeneratingForm).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('nodes.humanInputV2.template.testSaveFailed')
  })

  it('keeps the input screen available after a failed preview and allows retry', async () => {
    mockFetchHumanInputNodeStepRunForm.mockRejectedValueOnce(new Error('Preview unavailable'))
    const subject = renderSubject(createPayload())
    await act(async () => subject.result.current.form.handleShowGeneratedForm({}))
    expect(subject.result.current.form.showGeneratedForm).toBe(false)
    expect(subject.result.current.form.isGeneratingForm).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('Preview unavailable')
    await act(async () => subject.result.current.form.handleShowGeneratedForm({}))
    expect(subject.result.current.form.formData?.form_content).toBe('Rendered content')
  })

  it('normalizes nullable server defaults and rejects malformed response fields', async () => {
    mockFetchHumanInputNodeStepRunForm.mockResolvedValueOnce({
      ...mockFormData,
      inputs: [{ type: 'paragraph', output_variable_name: 'answer', default: null }],
    })
    const subject = renderSubject(createPayload())
    await act(async () => subject.result.current.form.handleShowGeneratedForm({}))
    expect(subject.result.current.form.formData?.inputs).toEqual([
      {
        type: InputVarType.paragraph,
        output_variable_name: 'answer',
        default: { type: 'constant', value: '', selector: [] },
      },
    ])
    act(() => subject.result.current.form.handleHideGeneratedForm())
    mockFetchHumanInputNodeStepRunForm.mockResolvedValueOnce({
      ...mockFormData,
      inputs: [{ type: 'unknown' }],
    })
    await act(async () => subject.result.current.form.handleShowGeneratedForm({}))
    expect(subject.result.current.form.showGeneratedForm).toBe(false)
    expect(subject.result.current.form.isGeneratingForm).toBe(false)
  })

  it.each([undefined, '2'] as const)(
    'automatically generates the V%s form when the child mounts in StrictMode',
    async (version) => {
      const payload = createPayload({ version, _isSingleRun: false })
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
          form.showGeneratedForm ? form.formData?.form_content : 'Generating form',
        )
      }
      const Panel = ({ open }: { open: boolean }) => {
        const form = useSingleRunFormParams({
          id: 'node-1',
          payload: { ...payload, _isSingleRun: open },
          runInputData: {},
          getInputVars,
          setRunInputData: () => undefined,
        })
        return open ? createElement(AutoGenerate, { form }) : null
      }
      const options = {
        hooksStoreProps: {
          doSyncWorkflowDraft: vi.fn(async () => ({ hash: 'saved', updatedAt: 1 })),
        },
        nodes: [createNode({ id: 'node-1', data: payload })],
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } as const,
      }
      const renderPanel = (open: boolean) =>
        createElement(StrictMode, null, createElement(Panel, { open }))
      const subject = renderWorkflowFlowComponent(renderPanel(false), options)

      subject.rerender(renderPanel(true))
      expect(await screen.findByText('Rendered content')).toBeInTheDocument()
      expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledOnce()
      subject.rerender(renderPanel(false))
      await waitFor(() => expect(screen.queryByText('Rendered content')).not.toBeInTheDocument())
      subject.rerender(renderPanel(true))
      expect(await screen.findByText('Rendered content')).toBeInTheDocument()
      expect(mockFetchHumanInputNodeStepRunForm).toHaveBeenCalledTimes(2)
    },
  )

  it('ignores an old form response after the single-run session closes and reopens', async () => {
    const payload = createPayload({ _isSingleRun: true })
    let resolveOld!: (value: HumanInputFormData) => void
    mockFetchHumanInputNodeStepRunForm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const subject = renderSubject(payload)
    let oldRequest!: Promise<void>
    act(() => {
      oldRequest = subject.result.current.form.handleShowGeneratedForm({ topic: 'old' })
    })
    setSingleRunOpen(subject, payload, false)
    setSingleRunOpen(subject, payload, true)
    await act(async () => subject.result.current.form.handleShowGeneratedForm({ topic: 'new' }))
    await act(async () => {
      resolveOld({ ...mockFormData, form_content: 'Old response' })
      await oldRequest
    })
    expect(subject.result.current.form.formData?.form_content).toBe('Rendered content')
    await act(async () =>
      subject.result.current.form.handleSubmitHumanInputForm({
        action: 'approve',
        inputs: {},
        form_inputs: {},
      }),
    )
    expect(mockSubmitHumanInputNodeStepRunForm).toHaveBeenLastCalledWith(
      '/apps/app-1/workflows/draft/human-input/nodes/node-1/form',
      { inputs: { topic: 'new' }, form_inputs: {}, action: 'approve' },
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
          `/apps/${input.params.app_id}/workflows/draft/human-input/nodes/${input.params.node_id}/form`,
          input.body,
        ),
      'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form.run.post': (input: {
        params: { app_id: string; node_id: string }
        body: unknown
      }) =>
        mockSubmitHumanInputNodeStepRunForm(
          `/apps/${input.params.app_id}/workflows/draft/human-input/nodes/${input.params.node_id}/form`,
          input.body,
        ),
    }),
  }
})
