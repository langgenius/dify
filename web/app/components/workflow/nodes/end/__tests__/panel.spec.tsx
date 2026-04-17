import type { EndNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'

const mockUseConfig = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

const createData = (overrides: Partial<EndNodeType> = {}): EndNodeType => ({
  title: 'End',
  desc: '',
  type: BlockEnum.End,
  outputs: [],
  ...overrides,
})

describe('EndPanel', () => {
  const handleVarListChange = vi.fn()
  const handleAddVariable = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue({
      readOnly: false,
      inputs: createData(),
      handleVarListChange,
      handleAddVariable,
    })
  })

  it('should show the output field and allow adding output variables when writable', () => {
    render(<Panel id="end-node" data={createData()} panelProps={{} as PanelProps} />)

    expect(screen.getByText('workflow.nodes.end.output.variable')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('add-button'))

    expect(handleAddVariable).toHaveBeenCalledTimes(1)
  })

  it('should hide the add action when the node is read-only', () => {
    mockUseConfig.mockReturnValue({
      readOnly: true,
      inputs: createData(),
      handleVarListChange,
      handleAddVariable,
    })

    render(<Panel id="end-node" data={createData()} panelProps={{} as PanelProps} />)

    expect(screen.queryByTestId('add-button')).not.toBeInTheDocument()
  })
})
