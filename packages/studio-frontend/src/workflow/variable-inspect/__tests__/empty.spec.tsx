import { render, screen } from '@testing-library/react'
import { createDocLinkMock, resolveDocLink } from '../../__tests__/i18n'
import Empty from '../empty'

const mockDocLink = createDocLinkMock()

vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

describe('VariableInspect Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the empty-state copy and docs link', () => {
    render(<Empty />)

    const link = screen.getByRole('link', { name: 'workflow.debug.variableInspect.emptyLink' })

    expect(screen.getByText('workflow.debug.variableInspect.title')).toBeInTheDocument()
    expect(screen.getByText('workflow.debug.variableInspect.emptyTip')).toBeInTheDocument()
    expect(link).toHaveAttribute('href', resolveDocLink('/use-dify/debug/variable-inspect'))
    expect(link).toHaveAttribute('target', '_blank')
    expect(mockDocLink).toHaveBeenCalledWith('/use-dify/debug/variable-inspect')
  })
})
