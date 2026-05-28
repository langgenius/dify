import type { PluginStatus } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { PluginSource, TaskStatus } from '@/app/components/plugins/types'
import PluginItem from '../plugin-item'

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src, size }: { src: string, size: string }) => (
    <div data-testid="card-icon" data-src={src} data-size={size} />
  ),
}))

const mockGetIconUrl = vi.fn((icon: string) => `https://example.com/icons/${icon}`)

const createPlugin = (overrides: Partial<PluginStatus> = {}): PluginStatus => ({
  plugin_unique_identifier: 'org/plugin:1.0.0',
  plugin_id: 'org/plugin',
  source: PluginSource.marketplace,
  status: TaskStatus.running,
  message: '',
  icon: 'icon.png',
  labels: {
    en_US: 'Test Plugin',
    zh_Hans: '测试插件',
  } as PluginStatus['labels'],
  taskId: 'task-1',
  ...overrides,
})

describe('PluginItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render plugin name based on language', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span data-testid="status-icon" />}
          statusText="Installing..."
        />,
      )

      expect(screen.getByText('Test Plugin')).toBeInTheDocument()
    })

    it('should render status text', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span data-testid="status-icon" />}
          statusText="Installing... please wait"
        />,
      )

      expect(screen.getByText('Installing... please wait')).toBeInTheDocument()
    })

    it('should render status icon', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span data-testid="status-icon" />}
          statusText="status"
        />,
      )

      expect(screen.getByTestId('status-icon')).toBeInTheDocument()
    })

    it('should anchor the status icon to the card icon wrapper', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span data-testid="status-icon" />}
          statusText="status"
        />,
      )

      const cardIcon = screen.getByTestId('card-icon')
      const iconWrapper = cardIcon.parentElement

      expect(iconWrapper).toHaveClass('relative', 'self-start')
      expect(screen.getByTestId('status-icon').parentElement).toHaveClass('absolute', '-bottom-0.5', '-right-0.5')
    })

    it('should pass icon url to CardIcon', () => {
      render(
        <PluginItem
          plugin={createPlugin({ icon: 'my-icon.svg' })}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span />}
          statusText="status"
        />,
      )

      expect(mockGetIconUrl).toHaveBeenCalledWith('my-icon.svg')
      const cardIcon = screen.getByTestId('card-icon')
      expect(cardIcon).toHaveAttribute('data-src', 'https://example.com/icons/my-icon.svg')
      expect(cardIcon).toHaveAttribute('data-size', 'small')
    })
  })

  describe('Props', () => {
    it('should apply custom statusClassName', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span />}
          statusText="done"
          statusClassName="text-text-success"
        />,
      )

      expect(screen.getByText('done').className).toContain('text-text-success')
    })

    it('should apply default statusClassName when not provided', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span />}
          statusText="done"
        />,
      )

      expect(screen.getByText('done').className).toContain('text-text-tertiary')
    })

    it('should render action when provided', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span />}
          statusText="status"
          action={<button>Install</button>}
        />,
      )

      expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument()
    })

    it('should not render action when not provided', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span />}
          statusText="status"
        />,
      )

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should render zh-Hans label when language is zh_Hans', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="zh_Hans"
          statusIcon={<span />}
          statusText="status"
        />,
      )

      expect(screen.getByText('测试插件')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should render clear button when onClear is provided', () => {
      const handleClear = vi.fn()
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span />}
          statusText="status"
          onClear={handleClear}
        />,
      )

      const clearButton = screen.getByRole('button')
      fireEvent.click(clearButton)

      expect(handleClear).toHaveBeenCalledTimes(1)
      expect(clearButton).toHaveClass('invisible', 'flex', 'group-hover/item:visible')
    })

    it('should not render clear button when onClear is not provided', () => {
      render(
        <PluginItem
          plugin={createPlugin()}
          getIconUrl={mockGetIconUrl}
          language="en_US"
          statusIcon={<span />}
          statusText="status"
        />,
      )

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })
})
