import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEvaluationStore, useIsEvaluationConfigDirty } from '../../store'
import EvaluationFrameworkSelector from '../evaluation-framework-selector'

const ConfigStatus = () => {
  const isDirty = useIsEvaluationConfigDirty('apps', 'app-1')
  return <output>{isDirty ? 'Unsaved' : 'Saved'}</output>
}

describe('EvaluationFrameworkSelector', () => {
  it('selects DeepEval, tracks the draft, and restores Ragas on reset', async () => {
    const user = userEvent.setup()
    act(() => useEvaluationStore.getState().ensureResource('apps', 'app-1'))
    render(
      <>
        <EvaluationFrameworkSelector resourceType="apps" resourceId="app-1" />
        <ConfigStatus />
      </>,
    )

    const trigger = screen.getByRole('combobox', { name: 'evaluation.judgeFramework.title' })
    expect(trigger).toHaveTextContent('Ragas')
    expect(screen.getByText('Saved')).toBeInTheDocument()

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'DeepEval' }))

    expect(trigger).toHaveTextContent('DeepEval')
    expect(screen.getByText('Unsaved')).toBeInTheDocument()

    act(() => useEvaluationStore.getState().resetResourceConfig('apps', 'app-1'))

    expect(trigger).toHaveTextContent('Ragas')
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
})
