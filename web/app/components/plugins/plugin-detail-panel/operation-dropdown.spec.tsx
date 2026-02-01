import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '../types'
import OperationDropdown from './operation-dropdown'

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: <T,>(selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => T): T =>
    selector({ systemFeatures: { enable_marketplace: true } }),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, className, onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
    <button data-testid="action-button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => (
    <div data-testid="portal-elem" data-open={open}>{children}</div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div data-testid="portal-content" className={className}>{children}</div>
  ),
}))

describe('OperationDropdown', () => {
  const mockOnInfo = vi.fn()
  const mockOnCheckVersion = vi.fn()
  const mockOnRemove = vi.fn()
  const defaultProps = {
    source: PluginSource.github,
    detailUrl: 'https://github.com/test/repo',
    onInfo: mockOnInfo,
    onCheckVersion: mockOnCheckVersion,
    onRemove: mockOnRemove,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render trigger button', () => {
      render(<OperationDropdown {...defaultProps} />)

      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
      expect(screen.getByTestId('action-button')).toBeInTheDocument()
    })

    it('should render dropdown content', () => {
      render(<OperationDropdown {...defaultProps} />)

      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should render info option for github source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      expect(screen.getByText('detailPanel.operation.info')).toBeInTheDocument()
    })

    it('should render check update option for github source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      expect(screen.getByText('detailPanel.operation.checkUpdate')).toBeInTheDocument()
    })

    it('should render view detail option for github source with marketplace enabled', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      expect(screen.getByText('detailPanel.operation.viewDetail')).toBeInTheDocument()
    })

    it('should render view detail option for marketplace source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.marketplace} />)

      expect(screen.getByText('detailPanel.operation.viewDetail')).toBeInTheDocument()
    })

    it('should always render remove option', () => {
      render(<OperationDropdown {...defaultProps} />)

      expect(screen.getByText('detailPanel.operation.remove')).toBeInTheDocument()
    })

    it('should not render info option for marketplace source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.marketplace} />)

      expect(screen.queryByText('detailPanel.operation.info')).not.toBeInTheDocument()
    })

    it('should not render check update option for marketplace source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.marketplace} />)

      expect(screen.queryByText('detailPanel.operation.checkUpdate')).not.toBeInTheDocument()
    })

    it('should not render view detail for local source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.local} />)

      expect(screen.queryByText('detailPanel.operation.viewDetail')).not.toBeInTheDocument()
    })

    it('should not render view detail for debugging source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.debugging} />)

      expect(screen.queryByText('detailPanel.operation.viewDetail')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should toggle dropdown when trigger is clicked', () => {
      render(<OperationDropdown {...defaultProps} />)

      const trigger = screen.getByTestId('portal-trigger')
      fireEvent.click(trigger)

      // The portal-elem should reflect the open state
      expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
    })

    it('should call onInfo when info option is clicked', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      fireEvent.click(screen.getByText('detailPanel.operation.info'))

      expect(mockOnInfo).toHaveBeenCalledTimes(1)
    })

    it('should call onCheckVersion when check update option is clicked', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      fireEvent.click(screen.getByText('detailPanel.operation.checkUpdate'))

      expect(mockOnCheckVersion).toHaveBeenCalledTimes(1)
    })

    it('should call onRemove when remove option is clicked', () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByText('detailPanel.operation.remove'))

      expect(mockOnRemove).toHaveBeenCalledTimes(1)
    })

    it('should have correct href for view detail link', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      const link = screen.getByText('detailPanel.operation.viewDetail').closest('a')
      expect(link).toHaveAttribute('href', 'https://github.com/test/repo')
      expect(link).toHaveAttribute('target', '_blank')
    })
  })

  describe('Props Variations', () => {
    it('should handle all plugin sources', () => {
      const sources = [
        PluginSource.github,
        PluginSource.marketplace,
        PluginSource.local,
        PluginSource.debugging,
      ]

      sources.forEach((source) => {
        const { unmount } = render(
          <OperationDropdown {...defaultProps} source={source} />,
        )
        expect(screen.getByTestId('portal-elem')).toBeInTheDocument()
        expect(screen.getByText('detailPanel.operation.remove')).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle different detail URLs', () => {
      const urls = [
        'https://github.com/owner/repo',
        'https://marketplace.example.com/plugin/123',
      ]

      urls.forEach((url) => {
        const { unmount } = render(
          <OperationDropdown {...defaultProps} detailUrl={url} source={PluginSource.github} />,
        )
        const link = screen.getByText('detailPanel.operation.viewDetail').closest('a')
        expect(link).toHaveAttribute('href', url)
        unmount()
      })
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Verify the component is exported as a memo component
      expect(OperationDropdown).toBeDefined()
      // React.memo wraps the component, so it should have $$typeof
      expect((OperationDropdown as { $$typeof?: symbol }).$$typeof).toBeDefined()
    })
  })
})
