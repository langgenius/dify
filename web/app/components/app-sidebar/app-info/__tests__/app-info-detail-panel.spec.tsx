import type { App, AppSSO } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { AppModeEnum } from '@/types/app'
import AppInfoDetailPanel from '../app-info-detail-panel'

vi.mock('../../../base/app-icon', () => ({
  default: ({ size, icon }: { size: string, icon: string }) => (
    <div data-testid="app-icon" data-size={size} data-icon={icon} />
  ),
}))

vi.mock('../app-info-detail-drawer', () => ({
  AppInfoDetailDrawer: ({ open, onClose, children }: {
    open: boolean
    onClose: () => void
    children: React.ReactNode
  }) => (
    open
      ? (
          <div data-testid="app-info-detail-drawer">
            <button type="button" data-testid="drawer-close" onClick={onClose}>Close</button>
            {children}
          </div>
        )
      : null
  ),
}))

vi.mock('@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/card-view', () => ({
  default: ({ appId }: { appId: string }) => (
    <div data-testid="card-view" data-app-id={appId} />
  ),
}))

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({ children, onClick, className, size, variant }: {
    children: React.ReactNode
    onClick?: () => void
    className?: string
    size?: string
    variant?: string
  }) => (
    <button type="button" onClick={onClick} className={className} data-size={size} data-variant={variant}>
      {children}
    </button>
  ),
}))

vi.mock('../app-operations', () => ({
  default: ({ primaryOperations, secondaryOperations }: {
    primaryOperations?: Array<{ id: string, title: string, onClick: () => void }>
    secondaryOperations?: Array<{ id: string, title: string, onClick: () => void, type?: string }>
  }) => (
    <div data-testid="app-operations">
      {primaryOperations?.map(op => (
        <button key={op.id} type="button" data-testid={`op-${op.id}`} onClick={op.onClick}>{op.title}</button>
      ))}
      {secondaryOperations?.map(op => (
        op.type === 'divider'
          ? <button key={op.id} type="button" data-testid={`op-${op.id}`} onClick={op.onClick}>divider</button>
          : <button key={op.id} type="button" data-testid={`op-${op.id}`} onClick={op.onClick}>{op.title}</button>
      ))}
    </div>
  ),
}))

const createAppDetail = (overrides: Partial<App> = {}): App & Partial<AppSSO> => ({
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.CHAT,
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#FFEAD5',
  icon_url: '',
  description: 'A test description',
  use_icon_as_answer_icon: false,
  ...overrides,
} as App & Partial<AppSSO>)

describe('AppInfoDetailPanel', () => {
  const defaultProps = {
    appDetail: createAppDetail(),
    show: true,
    onClose: vi.fn(),
    openModal: vi.fn(),
    exportCheck: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should not render when show is false', () => {
      render(<AppInfoDetailPanel {...defaultProps} show={false} />)
      expect(screen.queryByTestId('app-info-detail-drawer')).not.toBeInTheDocument()
    })

    it('should render drawer when show is true', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      expect(screen.getByTestId('app-info-detail-drawer')).toBeInTheDocument()
    })

    it('should display app name', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should display app mode label', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      expect(screen.getByText('app.types.chatbot')).toBeInTheDocument()
    })

    it('should display description when available', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      expect(screen.getByText('A test description')).toBeInTheDocument()
    })

    it('should not display description when empty', () => {
      render(<AppInfoDetailPanel {...defaultProps} appDetail={createAppDetail({ description: '' })} />)
      expect(screen.queryByText('A test description')).not.toBeInTheDocument()
    })

    it('should not display description when undefined', () => {
      render(<AppInfoDetailPanel {...defaultProps} appDetail={createAppDetail({ description: undefined as unknown as string })} />)
      expect(screen.queryByText('A test description')).not.toBeInTheDocument()
    })

    it('should render CardView with correct appId', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      const cardView = screen.getByTestId('card-view')
      expect(cardView).toHaveAttribute('data-app-id', 'app-1')
    })

    it('should render app icon with large size', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      const icon = screen.getByTestId('app-icon')
      expect(icon).toHaveAttribute('data-size', 'large')
    })
  })

  describe('Operations', () => {
    it('should render edit, duplicate, and export operations', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      expect(screen.getByTestId('op-edit')).toBeInTheDocument()
      expect(screen.getByTestId('op-duplicate')).toBeInTheDocument()
      expect(screen.getByTestId('op-export')).toBeInTheDocument()
    })

    it('should call openModal with edit when edit is clicked', async () => {
      const user = userEvent.setup()
      render(<AppInfoDetailPanel {...defaultProps} />)

      await user.click(screen.getByTestId('op-edit'))

      expect(defaultProps.openModal).toHaveBeenCalledWith('edit')
    })

    it('should call openModal with duplicate when duplicate is clicked', async () => {
      const user = userEvent.setup()
      render(<AppInfoDetailPanel {...defaultProps} />)

      await user.click(screen.getByTestId('op-duplicate'))

      expect(defaultProps.openModal).toHaveBeenCalledWith('duplicate')
    })

    it('should call exportCheck when export is clicked', async () => {
      const user = userEvent.setup()
      render(<AppInfoDetailPanel {...defaultProps} />)

      await user.click(screen.getByTestId('op-export'))

      expect(defaultProps.exportCheck).toHaveBeenCalledTimes(1)
    })

    it('should render delete operation', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      expect(screen.getByTestId('op-delete')).toBeInTheDocument()
    })

    it('should call openModal with delete when delete is clicked', async () => {
      const user = userEvent.setup()
      render(<AppInfoDetailPanel {...defaultProps} />)

      await user.click(screen.getByTestId('op-delete'))

      expect(defaultProps.openModal).toHaveBeenCalledWith('delete')
    })
  })

  describe('Import DSL option', () => {
    it('should show import DSL for advanced_chat mode', () => {
      render(
        <AppInfoDetailPanel
          {...defaultProps}
          appDetail={createAppDetail({ mode: AppModeEnum.ADVANCED_CHAT })}
        />,
      )
      expect(screen.getByTestId('op-import')).toBeInTheDocument()
    })

    it('should show import DSL for workflow mode', () => {
      render(
        <AppInfoDetailPanel
          {...defaultProps}
          appDetail={createAppDetail({ mode: AppModeEnum.WORKFLOW })}
        />,
      )
      expect(screen.getByTestId('op-import')).toBeInTheDocument()
    })

    it('should not show import DSL for chat mode', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      expect(screen.queryByTestId('op-import')).not.toBeInTheDocument()
    })

    it('should call openModal with importDSL when import is clicked', async () => {
      const user = userEvent.setup()
      render(
        <AppInfoDetailPanel
          {...defaultProps}
          appDetail={createAppDetail({ mode: AppModeEnum.ADVANCED_CHAT })}
        />,
      )
      await user.click(screen.getByTestId('op-import'))
      expect(defaultProps.openModal).toHaveBeenCalledWith('importDSL')
    })

    it('should render divider in secondary operations', async () => {
      const user = userEvent.setup()
      render(<AppInfoDetailPanel {...defaultProps} />)
      const divider = screen.getByTestId('op-divider-1')
      expect(divider).toBeInTheDocument()
      await user.click(divider)
    })
  })

  describe('Switch operation', () => {
    it('should show switch button for chat mode', () => {
      render(<AppInfoDetailPanel {...defaultProps} />)
      expect(screen.getByText('app.switch')).toBeInTheDocument()
    })

    it('should show switch button for completion mode', () => {
      render(
        <AppInfoDetailPanel
          {...defaultProps}
          appDetail={createAppDetail({ mode: AppModeEnum.COMPLETION })}
        />,
      )
      expect(screen.getByText('app.switch')).toBeInTheDocument()
    })

    it('should not show switch button for workflow mode', () => {
      render(
        <AppInfoDetailPanel
          {...defaultProps}
          appDetail={createAppDetail({ mode: AppModeEnum.WORKFLOW })}
        />,
      )
      expect(screen.queryByText('app.switch')).not.toBeInTheDocument()
    })

    it('should not show switch button for advanced_chat mode', () => {
      render(
        <AppInfoDetailPanel
          {...defaultProps}
          appDetail={createAppDetail({ mode: AppModeEnum.ADVANCED_CHAT })}
        />,
      )
      expect(screen.queryByText('app.switch')).not.toBeInTheDocument()
    })

    it('should call openModal with switch when switch button is clicked', async () => {
      const user = userEvent.setup()
      render(<AppInfoDetailPanel {...defaultProps} />)

      await user.click(screen.getByText('app.switch'))

      expect(defaultProps.openModal).toHaveBeenCalledWith('switch')
    })
  })

  describe('Drawer interactions', () => {
    it('should call onClose when drawer close button is clicked', async () => {
      const user = userEvent.setup()
      render(<AppInfoDetailPanel {...defaultProps} />)

      await user.click(screen.getByTestId('drawer-close'))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })
})
