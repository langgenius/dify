import { act, fireEvent, render, screen } from '@testing-library/react'
import Evaluation from '..'
import { getEvaluationMockConfig } from '../mock'
import { useEvaluationStore } from '../store'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({
    data: [{
      provider: 'openai',
      models: [{ model: 'gpt-4o-mini' }],
    }],
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel }: { defaultModel?: { provider: string, model: string } }) => (
    <div data-testid="evaluation-model-selector">
      {defaultModel ? `${defaultModel.provider}:${defaultModel.model}` : 'empty'}
    </div>
  ),
}))

describe('Evaluation', () => {
  beforeEach(() => {
    useEvaluationStore.setState({ resources: {} })
  })

  it('should search, add metrics, and create a batch history record', async () => {
    vi.useFakeTimers()

    render(<Evaluation resourceType="workflow" resourceId="app-1" />)

    expect(screen.getByTestId('evaluation-model-selector')).toHaveTextContent('openai:gpt-4o-mini')

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))
    expect(screen.getByTestId('evaluation-metric-loading')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    fireEvent.change(screen.getByPlaceholderText('evaluation.metrics.searchPlaceholder'), {
      target: { value: 'does-not-exist' },
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByText('evaluation.metrics.noResults')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('evaluation.metrics.searchPlaceholder'), {
      target: { value: 'faith' },
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    fireEvent.click(screen.getByRole('button', { name: /Faithfulness/i }))
    expect(screen.getAllByText('Faithfulness').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'evaluation.batch.run' }))
    expect(screen.getByText('evaluation.batch.status.running')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1300)
    })

    expect(screen.getByText('evaluation.batch.status.success')).toBeInTheDocument()
    expect(screen.getByText('Workflow evaluation batch')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('should render time placeholders and hide the value row for empty operators', () => {
    const resourceType = 'workflow'
    const resourceId = 'app-2'
    const store = useEvaluationStore.getState()
    const config = getEvaluationMockConfig(resourceType)

    const timeField = config.fieldOptions.find(field => field.type === 'time')!
    let groupId = ''
    let itemId = ''

    act(() => {
      store.ensureResource(resourceType, resourceId)
      store.setJudgeModel(resourceType, resourceId, 'openai::gpt-4o-mini')

      const group = useEvaluationStore.getState().resources['workflow:app-2'].conditions[0]
      groupId = group.id
      itemId = group.items[0].id

      store.updateConditionField(resourceType, resourceId, groupId, itemId, timeField.id)
      store.updateConditionOperator(resourceType, resourceId, groupId, itemId, 'before')
    })

    let rerender: ReturnType<typeof render>['rerender']
    act(() => {
      ({ rerender } = render(<Evaluation resourceType={resourceType} resourceId={resourceId} />))
    })

    expect(screen.getByText('evaluation.conditions.selectTime')).toBeInTheDocument()

    act(() => {
      store.updateConditionOperator(resourceType, resourceId, groupId, itemId, 'is_empty')
      rerender(<Evaluation resourceType={resourceType} resourceId={resourceId} />)
    })

    expect(screen.queryByText('evaluation.conditions.selectTime')).not.toBeInTheDocument()
  })
})
