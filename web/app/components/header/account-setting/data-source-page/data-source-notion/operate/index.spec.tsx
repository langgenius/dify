'use client'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import Toast from '@/app/components/base/toast'
import { syncDataSourceNotion, updateDataSourceNotionAction } from '@/service/common'
import { useInvalidDataSourceIntegrates } from '@/service/use-common'
import Operate from './index'

// Mock the services and components to isolate the test.
// We mock our own local services and Toast, but not third-party libraries like headlessui or remixicon.
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

vi.mock('@/service/common', () => ({
  syncDataSourceNotion: vi.fn(),
  updateDataSourceNotionAction: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useInvalidDataSourceIntegrates: vi.fn(),
}))

describe('Operate Component', () => {
  const mockPayload = {
    id: 'test-notion-id',
    total: 5,
  }
  const mockOnAuthAgain = vi.fn()
  const mockInvalidate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Setup mock implementations with correct CommonResponse type
    vi.mocked(useInvalidDataSourceIntegrates).mockReturnValue(mockInvalidate)
    vi.mocked(syncDataSourceNotion).mockResolvedValue({ result: 'success' })
    vi.mocked(updateDataSourceNotionAction).mockResolvedValue({ result: 'success' })
  })

  /**
   * Test rendering of the initial state (just the dots button).
   */
  it('renders the menu button initially', () => {
    render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)

    const menuButton = screen.getByRole('button')
    expect(menuButton).toBeInTheDocument()
    // Check that it doesn't have the "open" background class initially
    expect(menuButton).not.toHaveClass('bg-state-base-hover')
  })

  /**
   * Test opening the menu and verifying all choices are displayed correctly.
   */
  it('opens the menu and shows all options when clicked', async () => {
    render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)

    const menuButton = screen.getByRole('button')
    fireEvent.click(menuButton)

    // Verify all menu items are rendered with expected translated text (prefixed with common. ns as per mock)
    // Note: The i18n mock returns "common.key" when ns: "common" is passed.
    expect(await screen.findByText('common.dataSource.notion.changeAuthorizedPages')).toBeInTheDocument()
    expect(screen.getByText('common.dataSource.notion.sync')).toBeInTheDocument()
    expect(screen.getByText('common.dataSource.notion.remove')).toBeInTheDocument()

    // Check the "pages authorized" count display
    // The mock i18n serializes params: common.dataSource.notion.pagesAuthorized
    // Wait, the component does: {payload.total} {' '} {t('dataSource.notion.pagesAuthorized', { ns: 'common' })}
    // So it will look like "5 common.dataSource.notion.pagesAuthorized"
    expect(screen.getByText(/5/)).toBeInTheDocument()
    expect(screen.getByText(/common.dataSource.notion.pagesAuthorized/)).toBeInTheDocument()

    // Button should now have the "open" class
    expect(menuButton).toHaveClass('bg-state-base-hover')
  })

  /**
   * Test clicking "Change Authorized Pages" calls onAuthAgain.
   */
  it('calls onAuthAgain when the first menu item is clicked', async () => {
    render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)

    fireEvent.click(screen.getByRole('button'))
    const option = await screen.findByText('common.dataSource.notion.changeAuthorizedPages')
    fireEvent.click(option)

    expect(mockOnAuthAgain).toHaveBeenCalledTimes(1)
  })

  /**
   * Test clicking "Sync" calls the sync service and shows a success toast.
   */
  it('calls handleSync, shows success toast, and invalidates cache when Sync is clicked', async () => {
    render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)

    fireEvent.click(screen.getByRole('button'))
    const syncBtn = await screen.findByText('common.dataSource.notion.sync')
    fireEvent.click(syncBtn)

    // Ensure the service was called with the correct ID
    await waitFor(() => {
      expect(syncDataSourceNotion).toHaveBeenCalledWith({
        url: `/oauth/data-source/notion/${mockPayload.id}/sync`,
      })
    })

    // Check for success notification
    expect(Toast.notify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.success',
    })

    // Cache should be invalidated
    expect(mockInvalidate).toHaveBeenCalledTimes(1)
  })

  /**
   * Test clicking "Remove" calls the disable service and shows a success toast.
   */
  it('calls handleRemove, shows success toast, and invalidates cache when Remove is clicked', async () => {
    render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)

    fireEvent.click(screen.getByRole('button'))
    const removeBtn = await screen.findByText('common.dataSource.notion.remove')
    fireEvent.click(removeBtn)

    // Ensure the service was called with the correct ID
    await waitFor(() => {
      expect(updateDataSourceNotionAction).toHaveBeenCalledWith({
        url: `/data-source/integrates/${mockPayload.id}/disable`,
      })
    })

    // Check for success notification
    expect(Toast.notify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.success',
    })

    // Cache should be invalidated
    expect(mockInvalidate).toHaveBeenCalledTimes(1)
  })

  /**
   * Test that edge cases like transition or open state are correctly reflected.
   * This ensures branch coverage for the render prop (open).
   */
  it('toggles the open class on the button based on menu state', async () => {
    render(<Operate payload={mockPayload} onAuthAgain={mockOnAuthAgain} />)
    const menuButton = screen.getByRole('button')

    expect(menuButton).not.toHaveClass('bg-state-base-hover')

    fireEvent.click(menuButton)
    expect(menuButton).toHaveClass('bg-state-base-hover')

    // Clicking outside or escape to close (simple click again might close if toggle or click elsewhere)
    // For Headless UI, clicking the button again should toggle it if it's a MenuButton
    fireEvent.click(menuButton)
    await waitFor(() => {
      expect(menuButton).not.toHaveClass('bg-state-base-hover')
    })
  })
})
