import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { render, screen } from '@testing-library/react'
import Datasource from '../datasource'

vi.mock('@/app/components/workflow/hooks', () => ({
  useToolIcon: () => 'tool-icon',
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ toolIcon }: { toolIcon: string }) => <div data-testid="block-icon">{toolIcon}</div>,
}))

describe('Datasource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the datasource title and icon', () => {
    render(<Datasource nodeData={{ title: 'Knowledge Base' } as DataSourceNodeType} />)

    expect(screen.getByTestId('block-icon')).toHaveTextContent('tool-icon')
    expect(screen.getByText('Knowledge Base')).toBeInTheDocument()
  })
})
