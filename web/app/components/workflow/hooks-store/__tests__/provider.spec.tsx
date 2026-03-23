import { render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import { HooksStoreContext, HooksStoreContextProvider } from '../provider'

const mockRefreshAll = vi.fn()
const mockStore = {
  getState: () => ({
    refreshAll: mockRefreshAll,
  }),
}

let mockReactflowState = {
  d3Selection: null as object | null,
  d3Zoom: null as object | null,
}

vi.mock('reactflow', () => ({
  useStore: (selector: (state: typeof mockReactflowState) => unknown) => selector(mockReactflowState),
}))

vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store')
  return {
    ...actual,
    createHooksStore: vi.fn(() => mockStore),
  }
})

const Consumer = () => {
  const store = useContext(HooksStoreContext)
  return <div>{store ? 'has-hooks-store' : 'missing-hooks-store'}</div>
}

describe('hooks-store provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReactflowState = {
      d3Selection: null,
      d3Zoom: null,
    }
  })

  it('should provide the hooks store context without refreshing when the canvas handles are missing', () => {
    render(
      <HooksStoreContextProvider>
        <Consumer />
      </HooksStoreContextProvider>,
    )

    expect(screen.getByText('has-hooks-store')).toBeInTheDocument()
    expect(mockRefreshAll).not.toHaveBeenCalled()
  })

  it('should refresh the hooks store when both d3Selection and d3Zoom are available', async () => {
    const handleRun = vi.fn()
    mockReactflowState = {
      d3Selection: {},
      d3Zoom: {},
    }

    render(
      <HooksStoreContextProvider handleRun={handleRun}>
        <Consumer />
      </HooksStoreContextProvider>,
    )

    await waitFor(() => {
      expect(mockRefreshAll).toHaveBeenCalledWith({
        handleRun,
      })
    })
  })
})
