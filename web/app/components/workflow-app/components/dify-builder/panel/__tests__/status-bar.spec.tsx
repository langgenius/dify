import { render, screen } from '@testing-library/react'
import { DifyBuilderStatusBar } from '../status-bar'

describe('DifyBuilderStatusBar', () => {
  it.each([
    ['plan', 'processing', 'workflow.difyBuilder.status.planning'],
    [
      'test',
      'waiting_confirmation',
      'workflow.difyBuilder.status.testing · workflow.difyBuilder.status.waitingForConfirmation',
    ],
    [
      'clarify',
      'waiting_input',
      'workflow.difyBuilder.status.clarifying · workflow.difyBuilder.status.waitingForInput',
    ],
  ] as const)('shows phase and status while a command is active', (phase, runStatus, label) => {
    render(<DifyBuilderStatusBar phase={phase} runStatus={runStatus} />)

    const status = screen.getByRole('status', { name: label })
    for (const fragment of label.split(' · ')) expect(status).toHaveTextContent(fragment)
  })

  it.each([
    ['complete', 'workflow.difyBuilder.status.done'],
    ['failed', 'workflow.difyBuilder.status.failed'],
  ] as const)('shows only the explicit %s terminal state', (runStatus, label) => {
    render(<DifyBuilderStatusBar phase="publish" runStatus={runStatus} />)

    const status = screen.getByRole('status', { name: label })
    expect(status).toHaveTextContent(label)
    expect(status).not.toHaveTextContent('workflow.difyBuilder.status.publishing')
  })
})
