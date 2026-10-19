import type { PromptVariable } from '@/models/debug'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useNodes } from 'reactflow'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import Features from '../features'
import { InputVarType } from '../types'
import { createStartNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

const featureStore = createFeaturesStore()
const mockHandleAddVariable = vi.fn()
const mockUpdateFeatures = vi.fn()
const mockOpenOpeningModal = vi.fn<
  (options: {
    payload: {
      workflowVariables: unknown[]
      onAutoAddPromptVariable: (variables: PromptVariable[]) => void
    }
  }) => void
>()

vi.mock('../nodes/start/use-config', () => ({
  default: () => ({ handleAddVariable: mockHandleAddVariable }),
}))
vi.mock('@/service/workflow', () => ({
  updateFeatures: (...args: unknown[]) => mockUpdateFeatures(...args),
}))
vi.mock('@/context/modal-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/modal-context')>()),
  useModalContext: () => ({
    hasBlockingModalOpen: false,
    setShowOpeningModal: mockOpenOpeningModal,
  }),
}))
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/hooks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/header/account-setting/model-provider-page/hooks')
    >()),
    useDefaultModel: () => ({ data: null }),
  }),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'codeBasedExtension.get': async () => undefined,
    }),
  }
})

const startNode = createStartNode({
  id: 'start-node',
  data: {
    variables: [{ variable: 'existing_variable', label: 'Existing Variable' }],
  },
})
function ReadyFeatures() {
  const nodes = useNodes()
  return nodes.length ? <Features /> : null
}
function renderFeatures(mode: 'advanced-chat' | 'workflow' = 'advanced-chat') {
  return renderWorkflowFlowComponent(
    <NuqsTestingAdapter>
      <FeaturesContext.Provider value={featureStore}>
        <ReadyFeatures />
      </FeaturesContext.Provider>
    </NuqsTestingAdapter>,
    {
      resource: { kind: 'app', appId: 'app-1', mode },
      nodes: [startNode],
      edges: [],
      initialStoreState: { showFeaturesPanel: true },
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  featureStore.setState({ features: createFeaturesStore().getState().features })
  mockUpdateFeatures.mockResolvedValue(undefined)
})

it('persists a feature toggle through the workflow API and closes the panel', async () => {
  const user = userEvent.setup()
  const { store } = renderFeatures()
  const toggle = await screen.findByRole('switch', {
    name: 'appDebug.feature.suggestedQuestionsAfterAnswer.title',
  })
  await user.click(toggle)
  expect(toggle).toBeChecked()
  await waitFor(() =>
    expect(mockUpdateFeatures).toHaveBeenCalledWith({
      appId: 'app-1',
      features: expect.objectContaining({
        opening_statement: '',
        suggested_questions: [],
        suggested_questions_after_answer: { enabled: true },
      }),
    }),
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(store.getState().showFeaturesPanel).toBe(false)
})

it('omits chat-only feature controls for a workflow app', () => {
  renderFeatures('workflow')
  expect(screen.getByRole('dialog', { name: 'workflow.common.features' })).toBeInTheDocument()
  expect(
    screen.queryByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('switch', { name: 'appDebug.feature.suggestedQuestionsAfterAnswer.title' }),
  ).not.toBeInTheDocument()
})

it.each([true, undefined])(
  'converts an opening variable with required=%s into a start-node input',
  async (required) => {
    featureStore.setState({
      features: {
        ...featureStore.getState().features,
        opening: { enabled: true, opening_statement: 'Hello' },
      },
    })
    const user = userEvent.setup()
    renderFeatures()
    await user.hover(screen.getByText('appDebug.feature.conversationOpener.title'))
    const edit = screen.getByRole('button', { name: 'appDebug.openingStatement.writeOpener' })
    expect(edit).toBeEnabled()
    edit.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mockOpenOpeningModal).toHaveBeenCalled())
    const { payload } = mockOpenOpeningModal.mock.calls[0]![0]
    expect(startNode.data).toMatchObject({ variables: payload.workflowVariables })
    act(() =>
      payload.onAutoAddPromptVariable([
        { key: 'name', name: 'Name', type: 'string', max_length: 120, required },
      ]),
    )
    expect(mockHandleAddVariable).toHaveBeenCalledExactlyOnceWith({
      variable: 'name',
      label: 'Name',
      type: InputVarType.textInput,
      max_length: 120,
      required: !!required,
      options: [],
    })
  },
)
