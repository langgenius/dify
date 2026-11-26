import type { StartNodeType } from '../nodes/start/types'
import type { InputVar } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useNodes } from 'reactflow'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import Features from '../features'
import { InputVarType } from '../types'
import { createStartNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

const mockUpdateFeatures = vi.fn()
vi.mock('@/service/workflow', () => ({
  updateFeatures: (...args: unknown[]) => mockUpdateFeatures(...args),
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

const initialVariables: InputVar[] = [
  {
    variable: 'existing_variable',
    label: 'Existing Variable',
    type: InputVarType.textInput,
    required: true,
  },
]
const startNode = createStartNode({
  id: 'start-node',
  data: {
    variables: initialVariables,
  },
})
function ReadyFeatures() {
  const nodes = useNodes<StartNodeType>()
  return nodes.length ? (
    <>
      <Features />
      <output aria-label="Start variables">
        {JSON.stringify(nodes.find((node) => node.id === 'start-node')?.data.variables)}
      </output>
    </>
  ) : null
}
function renderFeatures(
  mode: 'advanced-chat' | 'workflow' = 'advanced-chat',
  openingEnabled = false,
) {
  const featureStore = createFeaturesStore({
    features: {
      ...createFeaturesStore().getState().features,
      opening: { enabled: openingEnabled, opening_statement: 'Hello' },
    },
  })
  return renderWorkflowFlowComponent(
    <NuqsTestingAdapter>
      <FeaturesContext value={featureStore}>
        <ReadyFeatures />
      </FeaturesContext>
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

it('adds an unknown opening variable to the start node after confirmation', async () => {
  const user = userEvent.setup()
  renderFeatures('advanced-chat', true)
  await user.hover(screen.getByText('appDebug.feature.conversationOpener.title'))
  const edit = screen.getByRole('button', { name: 'appDebug.openingStatement.writeOpener' })
  expect(edit).toBeEnabled()
  edit.focus()
  await user.keyboard('{Enter}')
  const editor = await screen.findByRole('textbox')
  await replacePromptEditorText(editor, 'Hello {{name}}')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await user.click(await screen.findByRole('button', { name: 'common.operation.add' }))
  expect(
    JSON.parse(screen.getByLabelText('Start variables', { selector: 'output' }).textContent!),
  ).toEqual([
    ...initialVariables,
    {
      variable: 'name',
      label: 'name',
      type: InputVarType.textInput,
      required: true,
      options: [],
    },
  ])
})
