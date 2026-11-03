import { screen } from '@testing-library/react'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import RunningTitle from '../running-title'

describe('RunningTitle', () => {
  it('shows the completed run time in the read-only workflow header', () => {
    const finishedAt = new Date(2026, 0, 15, 14, 30, 25).getTime() / 1000
    renderWorkflowComponent(<RunningTitle />, {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      initialStoreState: {
        historyWorkflowData: { id: 'history-1', status: 'succeeded', finished_at: finishedAt },
      },
    })

    expect(screen.getByText(/Test Run \((14|02):30:25( PM)?\)/)).toBeInTheDocument()
    expect(screen.getByText('workflow.common.viewOnly')).toBeInTheDocument()
  })

  it('identifies an unfinished chat run without inventing a completion time', () => {
    renderWorkflowComponent(<RunningTitle />, {
      resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
      initialStoreState: { historyWorkflowData: { id: 'history-2', status: 'running' } },
    })

    expect(screen.getByText('Test Chat (Running)')).toBeInTheDocument()
  })

  it.each(['workflow', 'advanced-chat'] as const)(
    'shows paused history in %s mode without a completion time',
    (mode) => {
      renderWorkflowComponent(<RunningTitle />, {
        resource: { kind: 'app', appId: 'app-1', mode },
        initialStoreState: { historyWorkflowData: { id: 'history-paused', status: 'paused' } },
      })

      expect(
        screen.getByText(`Test ${mode === 'advanced-chat' ? 'Chat' : 'Run'} (Paused)`),
      ).toBeInTheDocument()
    },
  )
})
