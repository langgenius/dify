import { render, screen } from '@testing-library/react'
import Empty from '../empty'

describe('VariableInspect Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the empty-state copy without documentation link', () => {
    render(<Empty />)

    expect(screen.getByText('workflow.debug.variableInspect.title')).toBeInTheDocument()
    expect(screen.getByText('workflow.debug.variableInspect.emptyTip')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'workflow.debug.variableInspect.emptyLink' })).not.toBeInTheDocument()
  })
})
