import type { CommonNodeType } from '../../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum, NodeRunningStatus } from '../../../types'
import NodeControl from './node-control'

const mockHandleNodeSelect = vi.fn()
const mockSetInitShowLastRunTab = vi.fn()
const mockSetPendingSingleRun = vi.fn()
const mockCanRunBySingle = vi.fn(() => true)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip" data-content={popupContent}>{children}</div>
  ),
}))

vi.mock('@/app/components/base/icons/src/vender/line/mediaAndDevices', () => ({
  Stop: ({ className }: { className?: string }) => <div data-testid="stop-icon" className={className} />,
}))

vi.mock('../../../hooks', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setInitShowLastRunTab: mockSetInitShowLastRunTab,
      setPendingSingleRun: mockSetPendingSingleRun,
    }),
  }),
}))

vi.mock('../../../utils', () => ({
  canRunBySingle: mockCanRunBySingle,
}))

vi.mock('./panel-operator', () => ({
  default: ({ onOpenChange }: { onOpenChange: (open: boolean) => void }) => (
    <>
      <button type="button" onClick={() => onOpenChange(true)}>open panel</button>
      <button type="button" onClick={() => onOpenChange(false)}>close panel</button>
    </>
  ),
}))

const makeData = (overrides: Partial<CommonNodeType> = {}): CommonNodeType => ({
  type: BlockEnum.Code,
  title: 'Node',
  desc: '',
  selected: false,
  _singleRunningStatus: undefined,
  isInIteration: false,
  isInLoop: false,
  ...overrides,
})

describe('NodeControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanRunBySingle.mockReturnValue(true)
  })

  it('should trigger a single run and show the hover control when plugins are not locked', () => {
    const { container } = render(
      <NodeControl
        id="node-1"
        data={makeData()}
      />,
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('group-hover:flex')
    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-content', 'panel.runThisStep')

    fireEvent.click(screen.getByTestId('tooltip').parentElement!)

    expect(mockSetInitShowLastRunTab).toHaveBeenCalledWith(true)
    expect(mockSetPendingSingleRun).toHaveBeenCalledWith({ nodeId: 'node-1', action: 'run' })
    expect(mockHandleNodeSelect).toHaveBeenCalledWith('node-1')
  })

  it('should render the stop action, keep locked controls hidden by default, and stay open when panel operator opens', () => {
    const { container } = render(
      <NodeControl
        id="node-2"
        pluginInstallLocked
        data={makeData({
          selected: true,
          _singleRunningStatus: NodeRunningStatus.Running,
          isInIteration: true,
        })}
      />,
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).not.toContain('group-hover:flex')
    expect(wrapper.className).toContain('!flex')
    expect(screen.getByTestId('stop-icon')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('stop-icon').parentElement!)

    expect(mockSetPendingSingleRun).toHaveBeenCalledWith({ nodeId: 'node-2', action: 'stop' })

    fireEvent.click(screen.getByRole('button', { name: 'open panel' }))
    expect(wrapper.className).toContain('!flex')
  })

  it('should hide the run control when single-node execution is not supported', () => {
    mockCanRunBySingle.mockReturnValue(false)

    render(
      <NodeControl
        id="node-3"
        data={makeData()}
      />,
    )

    expect(screen.queryByTestId('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open panel' })).toBeInTheDocument()
  })
})
