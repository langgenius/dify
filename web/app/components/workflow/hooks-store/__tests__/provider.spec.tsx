import { render, screen, waitFor } from '@testing-library/react'
import { use } from 'react'
import { HooksStoreContext, HooksStoreContextProvider } from '../provider'

const mockRefreshAll = vi.fn()
const mockStore = {
  getState: () => ({
    refreshAll: mockRefreshAll,
  }),
}

let mockReactflowState = {
  panZoom: null as object | null,
}

vi.mock('@xyflow/react', () => ({
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
  const store = use(HooksStoreContext)
  return <div>{store ? 'has-hooks-store' : 'missing-hooks-store'}</div>
}

describe('hooks-store provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReactflowState = {
      panZoom: null,
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

  it('should refresh the hooks store when panZoom is available', async () => {
    const handleRun = vi.fn()
    mockReactflowState = {
      panZoom: {},
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
