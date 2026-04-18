import { render, screen } from '@testing-library/react'
import * as React from 'react'
import Header from '../index'

let mockPathname = '/apps/demo/workflow'
let mockMaximizeCanvas = false
let mockWorkflowMode = {
  normal: true,
  restoring: false,
  viewHistory: false,
}

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('../../hooks', () => ({
  useWorkflowMode: () => mockWorkflowMode,
}))

vi.mock('../../store', () => ({
  useStore: <T,>(selector: (state: { maximizeCanvas: boolean }) => T) => selector({
    maximizeCanvas: mockMaximizeCanvas,
  }),
}))

vi.mock('@/next/dynamic', async () => {
  const ReactModule = await import('react')

  return {
    default: (
      loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>,
    ) => {
      const DynamicComponent = (props: Record<string, unknown>) => {
        const [Loaded, setLoaded] = ReactModule.useState<React.ComponentType<Record<string, unknown>> | null>(null)

        ReactModule.useEffect(() => {
          let mounted = true
          loader().then((mod) => {
            if (mounted)
              setLoaded(() => mod.default)
          })
          return () => {
            mounted = false
          }
        }, [])

        return Loaded ? <Loaded {...props} /> : null
      }

      return DynamicComponent
    },
  }
})

vi.mock('../header-in-normal', () => ({
  default: () => <div data-testid="header-normal">normal-layout</div>,
}))

vi.mock('../header-in-view-history', () => ({
  default: () => <div data-testid="header-history">history-layout</div>,
}))

vi.mock('../header-in-restoring', () => ({
  default: () => <div data-testid="header-restoring">restoring-layout</div>,
}))

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/apps/demo/workflow'
    mockMaximizeCanvas = false
    mockWorkflowMode = {
      normal: true,
      restoring: false,
      viewHistory: false,
    }
  })

  it('should render the normal layout and show the maximize spacer on workflow canvases', () => {
    mockMaximizeCanvas = true

    const { container } = render(<Header />)

    expect(screen.getByTestId('header-normal')).toBeInTheDocument()
    expect(screen.queryByTestId('header-history')).not.toBeInTheDocument()
    expect(screen.queryByTestId('header-restoring')).not.toBeInTheDocument()
    expect(container.querySelector('.h-14.w-\\[52px\\]')).not.toBeNull()
  })

  it('should switch between history and restoring layouts and skip the spacer outside canvas routes', async () => {
    mockPathname = '/apps/demo/logs'
    mockWorkflowMode = {
      normal: false,
      restoring: true,
      viewHistory: true,
    }

    const { container } = render(<Header />)

    expect(await screen.findByTestId('header-history')).toBeInTheDocument()
    expect(await screen.findByTestId('header-restoring')).toBeInTheDocument()
    expect(screen.queryByTestId('header-normal')).not.toBeInTheDocument()
    expect(container.querySelector('.h-14.w-\\[52px\\]')).toBeNull()
  })
})
