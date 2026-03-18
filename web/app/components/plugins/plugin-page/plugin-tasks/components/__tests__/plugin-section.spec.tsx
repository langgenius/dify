import type { PluginStatus } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { PluginSource, TaskStatus } from '@/app/components/plugins/types'
import PluginSection from '../plugin-section'

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src, size }: { src: string, size: string }) => (
    <div data-testid="card-icon" data-src={src} data-size={size} />
  ),
}))

const mockGetIconUrl = vi.fn((icon: string) => `https://icons/${icon}`)

const createPlugin = (id: string, name: string, message = ''): PluginStatus => ({
  plugin_unique_identifier: id,
  plugin_id: `org/${name.toLowerCase()}`,
  source: PluginSource.marketplace,
  status: TaskStatus.running,
  message,
  icon: `${name.toLowerCase()}.png`,
  labels: { en_US: name, zh_Hans: name } as PluginStatus['labels'],
  taskId: 'task-1',
})

const defaultProps = {
  title: 'Installing plugins',
  count: 2,
  plugins: [createPlugin('p1', 'PluginA'), createPlugin('p2', 'PluginB')],
  getIconUrl: mockGetIconUrl,
  language: 'en_US' as const,
  statusIcon: <span data-testid="status-icon" />,
  defaultStatusText: 'Default status',
}

describe('PluginSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render title and count', () => {
      render(<PluginSection {...defaultProps} />)

      expect(screen.getByText(/installing plugins/i)).toBeInTheDocument()
      expect(screen.getByText(/installing plugins/i).textContent).toContain('2')
    })

    it('should render all plugin items', () => {
      render(<PluginSection {...defaultProps} />)

      expect(screen.getByText('PluginA')).toBeInTheDocument()
      expect(screen.getByText('PluginB')).toBeInTheDocument()
    })

    it('should render status icons for each plugin', () => {
      render(<PluginSection {...defaultProps} />)

      expect(screen.getAllByTestId('status-icon')).toHaveLength(2)
    })
  })

  describe('Props', () => {
    it('should return null when plugins array is empty', () => {
      const { container } = render(
        <PluginSection {...defaultProps} plugins={[]} />,
      )

      expect(container.innerHTML).toBe('')
    })

    it('should use plugin.message as statusText when available', () => {
      const plugins = [createPlugin('p1', 'PluginA', 'Custom message')]
      render(<PluginSection {...defaultProps} plugins={plugins} count={1} />)

      expect(screen.getByText('Custom message')).toBeInTheDocument()
    })

    it('should use defaultStatusText when plugin has no message', () => {
      const plugins = [createPlugin('p1', 'PluginA', '')]
      render(<PluginSection {...defaultProps} plugins={plugins} count={1} />)

      expect(screen.getByText('Default status')).toBeInTheDocument()
    })

    it('should apply statusClassName to items', () => {
      const plugins = [createPlugin('p1', 'PluginA')]
      render(
        <PluginSection
          {...defaultProps}
          plugins={plugins}
          count={1}
          statusClassName="text-text-success"
        />,
      )

      expect(screen.getByText('Default status').className).toContain('text-text-success')
    })

    it('should render headerAction when provided', () => {
      render(
        <PluginSection
          {...defaultProps}
          headerAction={<button>Clear all</button>}
        />,
      )

      expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument()
    })

    it('should not render headerAction when not provided', () => {
      render(<PluginSection {...defaultProps} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should render item actions via renderItemAction', () => {
      render(
        <PluginSection
          {...defaultProps}
          renderItemAction={plugin => (
            <button>{`Action ${plugin.labels.en_US}`}</button>
          )}
        />,
      )

      expect(screen.getByRole('button', { name: /action plugina/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /action pluginb/i })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClearSingle with taskId and plugin identifier', () => {
      const onClearSingle = vi.fn()
      render(
        <PluginSection
          {...defaultProps}
          onClearSingle={onClearSingle}
        />,
      )

      // Clear buttons are rendered when onClearSingle is provided
      const clearButtons = screen.getAllByRole('button')
      fireEvent.click(clearButtons[0])

      expect(onClearSingle).toHaveBeenCalledWith('task-1', 'p1')
    })

    it('should not render clear buttons when onClearSingle is not provided', () => {
      render(<PluginSection {...defaultProps} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle single plugin', () => {
      const plugins = [createPlugin('p1', 'Solo')]
      render(<PluginSection {...defaultProps} plugins={plugins} count={1} />)

      expect(screen.getByText('Solo')).toBeInTheDocument()
      expect(screen.getByText(/solo/i).closest('.max-h-\\[300px\\]')).toBeInTheDocument()
    })
  })
})
