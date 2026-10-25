import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { PluginSource } from '../../types'
import { OperationDropdown } from '../operation-dropdown'

const render = (ui: ReactElement, enableMarketplace = true) =>
  renderWithConsoleQuery(ui, { systemFeatures: { enable_marketplace: enableMarketplace } })

const openDropdown = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }))
}

describe('OperationDropdown', () => {
  const mockOnInfo = vi.fn()
  const mockOnCheckVersion = vi.fn()
  const mockOnRemove = vi.fn()
  const mockOnViewReadme = vi.fn()
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
    it('should render marketplace detail action for marketplace source', async () => {
      const user = userEvent.setup()
      render(<OperationDropdown {...defaultProps} source={PluginSource.marketplace} />)

      await openDropdown(user)

      expect(screen.queryByText('plugin.detailPanel.operation.info')).not.toBeInTheDocument()
      expect(screen.queryByText('plugin.detailPanel.operation.checkUpdate')).not.toBeInTheDocument()
      expect(screen.getByText('plugin.detailPanel.operation.viewDetail')).toBeInTheDocument()
      expect(screen.getByText('plugin.detailPanel.operation.remove')).toBeInTheDocument()
    })

    it('should render README action only when provided', async () => {
      const user = userEvent.setup()
      const { unmount } = render(<OperationDropdown {...defaultProps} />)

      await openDropdown(user)
      expect(screen.queryByText('plugin.detailPanel.operation.viewReadme')).not.toBeInTheDocument()

      unmount()
      render(<OperationDropdown {...defaultProps} onViewReadme={mockOnViewReadme} />)
      await openDropdown(user)
      expect(screen.getByText('plugin.detailPanel.operation.viewReadme')).toBeInTheDocument()
    })

    it('should not render marketplace detail when source cannot open a detail page', async () => {
      const user = userEvent.setup()
      render(<OperationDropdown {...defaultProps} source={PluginSource.local} />)

      await openDropdown(user)

      expect(screen.queryByText('plugin.detailPanel.operation.viewDetail')).not.toBeInTheDocument()
      expect(screen.getByText('plugin.detailPanel.operation.remove')).toBeInTheDocument()
    })

    it('should not render the trigger when every action is unavailable', () => {
      render(
        <OperationDropdown
          {...defaultProps}
          source={PluginSource.local}
          showRemove={false}
          showCheckVersion={false}
        />,
      )

      expect(
        screen.queryByRole('button', { name: 'plugin.detailPanel.operation.moreActions' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onInfo when the info action is clicked', async () => {
      const user = userEvent.setup()
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      await openDropdown(user)
      await user.click(screen.getByText('plugin.detailPanel.operation.info'))

      expect(mockOnInfo).toHaveBeenCalledTimes(1)
    })

    it('should call onCheckVersion when the check update action is clicked', async () => {
      const user = userEvent.setup()
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      await openDropdown(user)
      await user.click(screen.getByText('plugin.detailPanel.operation.checkUpdate'))

      expect(mockOnCheckVersion).toHaveBeenCalledTimes(1)
    })

    it('should call onRemove when the remove action is clicked', async () => {
      const user = userEvent.setup()
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      await openDropdown(user)
      await user.click(screen.getByText('plugin.detailPanel.operation.remove'))

      expect(mockOnRemove).toHaveBeenCalledTimes(1)
    })

    it('should call onViewReadme when README action is clicked', async () => {
      const user = userEvent.setup()
      render(<OperationDropdown {...defaultProps} onViewReadme={mockOnViewReadme} />)

      await openDropdown(user)
      await user.click(screen.getByText('plugin.detailPanel.operation.viewReadme'))

      expect(mockOnViewReadme).toHaveBeenCalledTimes(1)
    })

    it('should render view detail as an external link', async () => {
      const user = userEvent.setup()
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />)

      await openDropdown(user)

      const link = screen.getByText('plugin.detailPanel.operation.viewDetail').closest('a')
      expect(link).toHaveAttribute('href', 'https://github.com/test/repo')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('Feature Flags', () => {
    it('should hide marketplace detail when marketplace is disabled', async () => {
      const user = userEvent.setup()
      render(<OperationDropdown {...defaultProps} source={PluginSource.github} />, false)

      await openDropdown(user)

      expect(screen.queryByText('plugin.detailPanel.operation.viewDetail')).not.toBeInTheDocument()
      expect(screen.getByText('plugin.detailPanel.operation.info')).toBeInTheDocument()
    })
  })
})
