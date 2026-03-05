import type { AppDetailResponse } from '@/models/app'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import { vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import AppSelector from './index'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

// Mock app context
vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

// Mock CreateAppDialog to avoid complex dependencies
vi.mock('@/app/components/app/create-app-dialog', () => ({
  default: ({ show, onClose }: { show: boolean, onClose: () => void }) => show
    ? (
        <div data-testid="create-app-dialog">
          <button onClick={onClose}>Close</button>
        </div>
      )
    : null,
}))

describe('AppSelector Component', () => {
  const mockPush = vi.fn()
  const mockAppItems = [
    { id: '1', name: 'App 1' },
    { id: '2', name: 'App 2' },
  ] as unknown as AppDetailResponse[]
  const mockCurApp = mockAppItems[0]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
    } as unknown as ReturnType<typeof useRouter>)
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceEditor: true,
    } as unknown as ReturnType<typeof useAppContext>)
  })

  describe('Rendering', () => {
    it('should render current app name', () => {
      render(<AppSelector appItems={mockAppItems} curApp={mockCurApp} />)
      expect(screen.getByText('App 1')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should open menu and show app items', async () => {
      render(<AppSelector appItems={mockAppItems} curApp={mockCurApp} />)

      const button = screen.getByRole('button', { name: /App 1/i })
      await act(async () => {
        fireEvent.click(button)
      })

      expect(screen.getByText('App 2')).toBeInTheDocument()
    })

    it('should navigate to configuration when an app is clicked and user is editor', async () => {
      render(<AppSelector appItems={mockAppItems} curApp={mockCurApp} />)

      const button = screen.getByRole('button', { name: /App 1/i })
      await act(async () => {
        fireEvent.click(button)
      })

      const app2Item = screen.getByText('App 2')
      await act(async () => {
        fireEvent.click(app2Item)
      })

      expect(mockPush).toHaveBeenCalledWith('/app/2/configuration')
    })

    it('should navigate to overview when an app is clicked and user is not editor', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceEditor: false,
      } as unknown as ReturnType<typeof useAppContext>)

      render(<AppSelector appItems={mockAppItems} curApp={mockCurApp} />)

      const button = screen.getByRole('button', { name: /App 1/i })
      await act(async () => {
        fireEvent.click(button)
      })

      const app2Item = screen.getByText('App 2')
      await act(async () => {
        fireEvent.click(app2Item)
      })

      expect(mockPush).toHaveBeenCalledWith('/app/2/overview')
    })
  })

  describe('New App Dialog', () => {
    it('should show "New App" button for editor and open dialog', async () => {
      render(<AppSelector appItems={mockAppItems} curApp={mockCurApp} />)

      const button = screen.getByRole('button', { name: /App 1/i })
      await act(async () => {
        fireEvent.click(button)
      })

      const newAppBtn = screen.getByText('common.menus.newApp')
      await act(async () => {
        fireEvent.click(newAppBtn)
      })

      expect(screen.getByTestId('create-app-dialog')).toBeInTheDocument()
    })

    it('should not show "New App" button for non-editor', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceEditor: false,
      } as unknown as ReturnType<typeof useAppContext>)

      render(<AppSelector appItems={mockAppItems} curApp={mockCurApp} />)

      const button = screen.getByRole('button', { name: /App 1/i })
      await act(async () => {
        fireEvent.click(button)
      })

      expect(screen.queryByText('common.menus.newApp')).not.toBeInTheDocument()
    })

    it('should close dialog when onClose is called', async () => {
      render(<AppSelector appItems={mockAppItems} curApp={mockCurApp} />)

      const button = screen.getByRole('button', { name: /App 1/i })
      await act(async () => {
        fireEvent.click(button)
      })

      const newAppBtn = screen.getByText('common.menus.newApp')
      await act(async () => {
        fireEvent.click(newAppBtn)
      })

      const closeBtn = screen.getByText('Close')
      await act(async () => {
        fireEvent.click(closeBtn)
      })

      expect(screen.queryByTestId('create-app-dialog')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render nothing in menu if appItems is empty', async () => {
      render(<AppSelector appItems={[]} curApp={mockCurApp} />)

      const button = screen.getByRole('button', { name: /App 1/i })
      await act(async () => {
        fireEvent.click(button)
      })

      expect(screen.queryByText('App 2')).not.toBeInTheDocument()
      // "New App" should still be there if editor
      expect(screen.getByText('common.menus.newApp')).toBeInTheDocument()
    })
  })
})
