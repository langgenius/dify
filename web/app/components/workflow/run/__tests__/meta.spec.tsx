import { screen } from '@testing-library/react'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import Meta from '../meta'

describe('run metadata', () => {
  it('withholds token totals while paused and reveals completed metrics without hidden step counts', () => {
    const props = { executor: 'Alice', time: 1.2349, tokens: 42, steps: 3, showSteps: false }
    const { rerender } = renderWithAccountProfile(<Meta status="paused" {...props} />)
    expect(screen.getByText('appLog.status.paused')).toBeInTheDocument()
    expect(screen.queryByText('42 Tokens')).not.toBeInTheDocument()

    rerender(<Meta status="succeeded" {...props} />)

    expect(screen.getByText('appLog.status.succeeded')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('1.235s')).toBeInTheDocument()
    expect(screen.getByText('42 Tokens')).toBeInTheDocument()
    expect(screen.queryByText('runLog.meta.steps')).not.toBeInTheDocument()
  })
})
