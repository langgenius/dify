import type { ReactElement, ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { cloneElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginSource } from '../../types'
import OperationDropdown from '../operation-dropdown'

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: <T,>(selector: (state: { systemFeatures: { enable_marketplace: boolean } }) => T): T =>
    selector({ systemFeatures: { enable_marketplace: true } }),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/components/base/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, open }: { children: ReactNode, open: boolean }) => (
    <div data-testid="dropdown-menu" data-open={open}>{children}</div>
  ),
  DropdownMenuTrigger: ({ children, className }: { children: ReactNode, className?: string }) => (
    <button data-testid="dropdown-trigger" className={className}>{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({ children, onClick, render, destructive }: { children: ReactNode, onClick?: () => void, render?: ReactElement, destructive?: boolean }) => {
    if (render)
      return cloneElement(render, { onClick, 'data-destructive': destructive } as Record<string, unknown>, children)
    return <div data-testid="dropdown-item" data-destructive={destructive} onClick={onClick}>{children}</div>
  },
  DropdownMenuSeparator: () => <hr data-testid="dropdown-separator" />,
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

      expect(screen.getByTestId('dropdown-trigger')).toBeInTheDocument()
    })

    it('should render dropdown content', () => {
      render(<OperationDropdown {...defaultProps} />)

      expect(screen.getByTestId('dropdown-content')).toBeInTheDocument()
    })

    it('should render info option for github source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      expect(screen.getByText('plugin.detailPanel.operation.info')).toBeInTheDocument()
    })

    it('should render check update option for github source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      expect(screen.getByText('plugin.detailPanel.operation.checkUpdate')).toBeInTheDocument()
    })

    it('should render view detail option for github source with marketplace enabled', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      expect(screen.getByText('plugin.detailPanel.operation.viewDetail')).toBeInTheDocument()
    })

    it('should render view detail option for marketplace source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.marketplace} />)

      expect(screen.getByText('plugin.detailPanel.operation.viewDetail')).toBeInTheDocument()
    })

    it('should always render remove option', () => {
      render(<OperationDropdown {...defaultProps} />)

      expect(screen.getByText('plugin.detailPanel.operation.remove')).toBeInTheDocument()
    })

    it('should not render info option for marketplace source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.marketplace} />)

      expect(screen.queryByText('plugin.detailPanel.operation.info')).not.toBeInTheDocument()
    })

    it('should not render check update option for marketplace source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.marketplace} />)

      expect(screen.queryByText('plugin.detailPanel.operation.checkUpdate')).not.toBeInTheDocument()
    })

    it('should not render view detail for local source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.local} />)

      expect(screen.queryByText('plugin.detailPanel.operation.viewDetail')).not.toBeInTheDocument()
    })

    it('should not render view detail for debugging source', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.debugging} />)

      expect(screen.queryByText('plugin.detailPanel.operation.viewDetail')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should render dropdown menu root', () => {
      render(<OperationDropdown {...defaultProps} />)

      expect(screen.getByTestId('dropdown-menu')).toBeInTheDocument()
    })

    it('should call onInfo when info option is clicked', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      fireEvent.click(screen.getByText('plugin.detailPanel.operation.info'))

      expect(mockOnInfo).toHaveBeenCalledTimes(1)
    })

    it('should call onCheckVersion when check update option is clicked', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      fireEvent.click(screen.getByText('plugin.detailPanel.operation.checkUpdate'))

      expect(mockOnCheckVersion).toHaveBeenCalledTimes(1)
    })

    it('should call onRemove when remove option is clicked', () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByText('plugin.detailPanel.operation.remove'))

      expect(mockOnRemove).toHaveBeenCalledTimes(1)
    })

    it('should have correct href for view detail link', () => {
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      const link = screen.getByText('plugin.detailPanel.operation.viewDetail').closest('a')
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
        expect(screen.getByTestId('dropdown-menu')).toBeInTheDocument()
        expect(screen.getByText('plugin.detailPanel.operation.remove')).toBeInTheDocument()
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
        const link = screen.getByText('plugin.detailPanel.operation.viewDetail').closest('a')
        expect(link).toHaveAttribute('href', url)
        unmount()
      })
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(OperationDropdown).toBeDefined()
      expect((OperationDropdown as { $$typeof?: symbol }).$$typeof).toBeDefined()
    })
  })
})
