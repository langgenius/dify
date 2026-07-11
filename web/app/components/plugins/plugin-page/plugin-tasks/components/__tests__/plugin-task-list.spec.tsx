import type { PluginStatus } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { PluginSource, TaskStatus } from '@/app/components/plugins/types'
import PluginTaskList from '../plugin-task-list'

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: ({ src, size }: { src: string, size: string }) => (
    <div data-testid="card-icon" data-src={src} data-size={size} />
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: () => <div data-testid="install-modal" />,
}))

vi.mock('@/service/plugins', () => ({
  fetchPluginInfoFromMarketPlace: vi.fn(),
}))
const mockGetIconUrl = vi.fn((icon: string) => `https://icons/${icon}`)

const createPlugin = (id: string, name: string, overrides: Partial<PluginStatus> = {}): PluginStatus => ({
  plugin_unique_identifier: id,
  plugin_id: `org/${name.toLowerCase()}`,
  source: PluginSource.marketplace,
  status: TaskStatus.running,
  message: '',
  icon: `${name.toLowerCase()}.png`,
  labels: { en_US: name } as PluginStatus['labels'],
  taskId: 'task-1',
  ...overrides,
})

const runningPlugins = [
  createPlugin('r1', 'OpenAI', { status: TaskStatus.running }),
  createPlugin('r2', 'Anthropic', { status: TaskStatus.running }),
]

const errorPlugins = [
  createPlugin('e1', 'DALLE', { status: TaskStatus.failed, plugin_id: 'org/dalle' }),
]

const successPlugins = [
  createPlugin('s1', 'Google', { status: TaskStatus.success }),
]

describe('PluginTaskList', () => {
  const defaultProps = {
    runningPlugins: [] as PluginStatus[],
    successPlugins: [] as PluginStatus[],
    errorPlugins: [] as PluginStatus[],
    getIconUrl: mockGetIconUrl,
    onClearAll: vi.fn(),
    onClearErrors: vi.fn(),
    onClearSingle: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render empty container when no plugins', () => {
      render(<PluginTaskList {...defaultProps} />)
      expect(screen.queryByText(/plugin\.task\.runningPlugins/)).not.toBeInTheDocument()
      expect(screen.queryByText(/plugin\.task\.successPlugins/)).not.toBeInTheDocument()
      expect(screen.queryByText(/plugin\.task\.errorPlugins/)).not.toBeInTheDocument()
    })

    it('should render running section when running plugins exist', () => {
      render(<PluginTaskList {...defaultProps} runningPlugins={runningPlugins} />)

      expect(screen.getByText(/plugin\.task\.runningPlugins/)).toBeInTheDocument()
      expect(screen.getByText('OpenAI'))!.toBeInTheDocument()
      expect(screen.getByText('Anthropic'))!.toBeInTheDocument()
    })

    it('should render success plugins in the dropdown', () => {
      render(<PluginTaskList {...defaultProps} successPlugins={successPlugins} />)

      expect(screen.getByText(/plugin\.task\.successPlugins/)).toBeInTheDocument()
      expect(screen.getByText('Google'))!.toBeInTheDocument()
    })

    it('should render error section when error plugins exist', () => {
      render(<PluginTaskList {...defaultProps} errorPlugins={errorPlugins} />)

      expect(screen.getByText(/plugin\.task\.errorPlugins/)).toBeInTheDocument()
      expect(screen.getByText('DALLE'))!.toBeInTheDocument()
    })

    it('should render separate running and error sections when both exist', () => {
      render(
        <PluginTaskList
          {...defaultProps}
          runningPlugins={runningPlugins}
          errorPlugins={errorPlugins}
        />,
      )

      expect(screen.getByText('OpenAI'))!.toBeInTheDocument()
      expect(screen.queryByText('Google'))!.not.toBeInTheDocument()
      expect(screen.getByText('DALLE'))!.toBeInTheDocument()
      expect(screen.getByText(/plugin\.task\.runningPlugins/)).toBeInTheDocument()
      expect(screen.getByText(/plugin\.task\.errorPlugins/)).toBeInTheDocument()
    })
  })

  describe('Clear actions', () => {
    it('should show Clear all button in error section', () => {
      render(<PluginTaskList {...defaultProps} errorPlugins={errorPlugins} />)

      expect(screen.getByRole('button', { name: /plugin\.task\.errorPlugins.*plugin\.task\.clearAll/ })).toBeInTheDocument()
    })

    it('should call onClearErrors when error section Clear all is clicked', () => {
      const onClearErrors = vi.fn()
      render(
        <PluginTaskList
          {...defaultProps}
          errorPlugins={errorPlugins}
          onClearErrors={onClearErrors}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /plugin\.task\.errorPlugins.*plugin\.task\.clearAll/ }))
      expect(onClearErrors).toHaveBeenCalledTimes(1)
    })

    it('should expose section-specific Clear all button names when success and error sections coexist', () => {
      render(
        <PluginTaskList
          {...defaultProps}
          successPlugins={successPlugins}
          errorPlugins={errorPlugins}
        />,
      )

      expect(screen.getByRole('button', { name: /plugin\.task\.successPlugins.*plugin\.task\.clearAll/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /plugin\.task\.errorPlugins.*plugin\.task\.clearAll/ })).toBeInTheDocument()
    })
  })

  describe('Running section', () => {
    it('should not render clear buttons for running plugins', () => {
      render(<PluginTaskList {...defaultProps} runningPlugins={runningPlugins} />)

      expect(screen.queryByText(/plugin\.task\.clearAll/)).not.toBeInTheDocument()
    })

    it('should show installing hint as status text', () => {
      render(<PluginTaskList {...defaultProps} runningPlugins={runningPlugins} />)

      // defaultStatusText is t('task.installingHint', { ns: 'plugin' })
      const hintTexts = screen.getAllByText(/plugin\.task\.installingHint/)
      expect(hintTexts.length).toBeGreaterThan(0)
    })
  })

  describe('Error section clear single', () => {
    it('should call onClearSingle from error item clear button', () => {
      const onClearSingle = vi.fn()
      render(
        <PluginTaskList
          {...defaultProps}
          errorPlugins={errorPlugins}
          onClearSingle={onClearSingle}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /Clear DALLE/i }))

      expect(onClearSingle).toHaveBeenCalledWith('task-1', 'e1')
    })
  })

  describe('Edge Cases', () => {
    it('should not render sections for empty plugin arrays', () => {
      render(
        <PluginTaskList
          {...defaultProps}
          runningPlugins={[]}
          errorPlugins={[]}
        />,
      )

      expect(screen.queryByText(/plugin\.task\.runningPlugins/)).not.toBeInTheDocument()
      expect(screen.queryByText(/plugin\.task\.errorPlugins/)).not.toBeInTheDocument()
    })

    it('should render error section with multiple error plugins', () => {
      const multipleErrors = [
        createPlugin('e1', 'PluginA', { status: TaskStatus.failed, plugin_id: 'org/a' }),
        createPlugin('e2', 'PluginB', { status: TaskStatus.failed, plugin_id: 'https://github.com/b' }),
        createPlugin('e3', 'PluginC', { status: TaskStatus.failed, plugin_id: 'local-only' }),
      ]

      render(<PluginTaskList {...defaultProps} errorPlugins={multipleErrors} />)

      expect(screen.getByText('PluginA'))!.toBeInTheDocument()
      expect(screen.getByText('PluginB'))!.toBeInTheDocument()
      expect(screen.getByText('PluginC'))!.toBeInTheDocument()
    })
  })
})
