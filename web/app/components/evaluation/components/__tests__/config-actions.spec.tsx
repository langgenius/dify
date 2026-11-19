import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEvaluationStore } from '../../store'
import ConditionGroup from '../conditions-section/condition-group'
import EvaluationConfigActions from '../config-actions'

const { saveConfig, toast } = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))
vi.mock('@/app/notifications', () => ({ toast }))
vi.mock('../../queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../queries')>()),
  useEvaluationActions: () => ({ saveConfig, isSaving: false }),
}))

const resourceId = 'app-1'

const setup = () => {
  act(() => {
    const store = useEvaluationStore.getState()
    store.hydrateResource('apps', resourceId, {
      evaluation_framework: 'ragas',
      evaluation_model: 'claude-sonnet-5',
      evaluation_model_provider: 'anthropic',
      default_metrics: [
        {
          metric: 'answer_correctness',
          node_info_list: [{ node_id: 'llm-1', title: 'LLM', type: 'llm' }],
        },
      ],
    })
    store.addCondition('apps', resourceId)
  })

  render(
    <>
      <EvaluationConfigActions resourceType="apps" resourceId={resourceId} />
      <ConditionGroup resourceType="apps" resourceId={resourceId} />
    </>,
  )
}

describe('EvaluationConfigActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEvaluationStore.setState({ resources: {}, initialResources: {}, conditionErrorsVisible: {} })
  })

  it('blocks saving an incomplete condition and points to it', async () => {
    const user = userEvent.setup()
    setup()

    // The new condition starts at "≥" on the metric's display name, with no value yet.
    expect(
      screen.getByRole('combobox', { name: 'evaluation.conditions.operator' }),
    ).toHaveTextContent('≥')
    expect(screen.getByText('Answer Correctness')).toBeInTheDocument()
    expect(screen.queryByText('evaluation.conditions.valueRequired')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(saveConfig).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('evaluation.conditions.incomplete')
    expect(screen.getByText('evaluation.conditions.valueRequired')).toBeInTheDocument()

    await user.type(
      screen.getByRole('spinbutton', { name: 'evaluation.conditions.valuePlaceholder' }),
      '0.7',
    )
    expect(screen.queryByText('evaluation.conditions.valueRequired')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(saveConfig).toHaveBeenCalledOnce()
  })

  it('keeps Save disabled until the configuration changes', () => {
    act(() =>
      useEvaluationStore.getState().hydrateResource('apps', resourceId, {
        evaluation_framework: 'ragas',
        evaluation_model: 'claude-sonnet-5',
        evaluation_model_provider: 'anthropic',
        default_metrics: [
          {
            metric: 'answer_correctness',
            node_info_list: [{ node_id: 'llm-1', title: 'LLM', type: 'llm' }],
          },
        ],
      }),
    )
    render(<EvaluationConfigActions resourceType="apps" resourceId={resourceId} />)

    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.reset' })).toBeDisabled()
  })
})
