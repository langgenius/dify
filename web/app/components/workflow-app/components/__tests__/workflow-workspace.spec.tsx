import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import WorkflowWorkspace from '../workflow-workspace'

let mockShowDifyBuilderPanel = false

vi.mock('@/app/components/workflow', () => ({
  Workflow: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <section data-testid="workflow-canvas" className={className}>
      {children}
    </section>
  ),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  HooksStoreContextProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { showDifyBuilderPanel: boolean }) => T) =>
    selector({
      showDifyBuilderPanel: mockShowDifyBuilderPanel,
    }),
}))

vi.mock('../dify-builder/provider', () => ({
  DifyBuilderProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/next/dynamic', () => ({
  default: () => () => <aside aria-label="App Builder">builder-panel</aside>,
}))

describe('WorkflowWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShowDifyBuilderPanel = false
  })

  it('renders App Builder as a sibling of the canvas and forwards the canvas ref', () => {
    mockShowDifyBuilderPanel = true
    const canvasRef = createRef<HTMLDivElement>()

    render(
      <WorkflowWorkspace nodes={[]} edges={[]} className="consumer-class" canvasRef={canvasRef}>
        <div>workflow-chrome</div>
      </WorkflowWorkspace>,
    )

    const workflow = screen.getByTestId('workflow-canvas')
    const canvasColumn = workflow.parentElement
    const builder = screen.getByRole('complementary', { name: 'App Builder' })

    expect(workflow).toHaveClass('min-w-0', 'consumer-class')
    expect(canvasColumn).toBe(canvasRef.current)
    expect(canvasColumn?.nextElementSibling).toBe(builder)
    expect(canvasColumn).not.toContainElement(builder)
    expect(screen.getByText('workflow-chrome')).toBeInTheDocument()
  })

  it('keeps canvas overlays inside the canvas column when App Builder is closed', () => {
    render(
      <WorkflowWorkspace nodes={[]} edges={[]} canvasOverlay={<div role="status">syncing</div>} />,
    )

    const canvasColumn = screen.getByTestId('workflow-canvas').parentElement

    expect(screen.queryByRole('complementary', { name: 'App Builder' })).not.toBeInTheDocument()
    expect(canvasColumn).toContainElement(screen.getByRole('status'))
  })
})
