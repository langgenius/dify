import { render, screen } from '@testing-library/react'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../../constants'
import Sidebar from './sidebar'

type ResizePanelParams = {
  direction?: 'horizontal' | 'vertical' | 'both'
  triggerDirection?: string
  minWidth?: number
  maxWidth?: number
  onResize?: (width: number, height: number) => void
}

const mocks = vi.hoisted(() => ({
  lastResizeParams: undefined as ResizePanelParams | undefined,
  storageGetNumber: vi.fn(),
  storageSet: vi.fn(),
}))

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (value: number) => void) => ({
    run: fn,
  }),
}))

vi.mock('../../../nodes/_base/hooks/use-resize-panel', () => ({
  useResizePanel: (params?: ResizePanelParams) => {
    mocks.lastResizeParams = params
    return {
      triggerRef: { current: null },
      containerRef: { current: null },
    }
  },
}))

vi.mock('@/utils/storage', () => ({
  storage: {
    getNumber: (...args: unknown[]) => mocks.storageGetNumber(...args),
    set: (...args: unknown[]) => mocks.storageSet(...args),
  },
}))

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lastResizeParams = undefined
    mocks.storageGetNumber.mockReturnValue(360)
  })

  describe('Rendering', () => {
    it('should render sidebar with persisted width when stored value exists', () => {
      // Arrange
      const { container } = render(
        <Sidebar>
          <div>sidebar-content</div>
        </Sidebar>,
      )

      // Act
      const aside = container.querySelector('aside')

      // Assert
      expect(aside).toBeInTheDocument()
      expect(aside).toHaveStyle({ width: '360px' })
      expect(screen.getByText('sidebar-content')).toBeInTheDocument()
      expect(mocks.storageGetNumber).toHaveBeenCalledWith(
        STORAGE_KEYS.LOCAL.SKILL.SIDEBAR_WIDTH,
        SIDEBAR_DEFAULT_WIDTH,
      )
    })
  })

  describe('Resize behavior', () => {
    it('should configure horizontal resize constraints when mounting', () => {
      // Arrange
      render(<Sidebar />)

      // Assert
      expect(mocks.lastResizeParams).toMatchObject({
        direction: 'horizontal',
        triggerDirection: 'right',
        minWidth: SIDEBAR_MIN_WIDTH,
        maxWidth: SIDEBAR_MAX_WIDTH,
      })
    })

    it('should persist new width when resize callback is triggered', () => {
      // Arrange
      render(<Sidebar />)

      // Act
      mocks.lastResizeParams?.onResize?.(420, 0)

      // Assert
      expect(mocks.storageSet).toHaveBeenCalledTimes(1)
      expect(mocks.storageSet).toHaveBeenCalledWith(STORAGE_KEYS.LOCAL.SKILL.SIDEBAR_WIDTH, 420)
    })
  })

  describe('Edge Cases', () => {
    it('should render container when children is null', () => {
      // Arrange
      const { container } = render(<Sidebar>{null}</Sidebar>)

      // Act
      const aside = container.querySelector('aside')

      // Assert
      expect(aside).toBeInTheDocument()
      expect(aside?.childElementCount).toBeGreaterThan(0)
    })
  })
})
