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

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
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

const successPlugins = [
  createPlugin('s1', 'Google', { status: TaskStatus.success }),
]

const errorPlugins = [
  createPlugin('e1', 'DALLE', { status: TaskStatus.failed, plugin_id: 'org/dalle' }),
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
      const { container } = render(<PluginTaskList {...defaultProps} />)
      const wrapper = container.firstElementChild!
      expect(wrapper).toBeInTheDocument()
      expect(wrapper.children).toHaveLength(0)
    })

    it('should render running section when running plugins exist', () => {
      const { container } = render(<PluginTaskList {...defaultProps} runningPlugins={runningPlugins} />)

      // Header contains the title text
      const headers = container.querySelectorAll('.system-sm-semibold-uppercase')
      expect(headers).toHaveLength(1)
      expect(headers[0].textContent).toContain('plugin.task.installing')
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
    })

    it('should render success section when success plugins exist', () => {
      const { container } = render(<PluginTaskList {...defaultProps} successPlugins={successPlugins} />)

      const headers = container.querySelectorAll('.system-sm-semibold-uppercase')
      expect(headers).toHaveLength(1)
      expect(headers[0].textContent).toContain('plugin.task.installed')
      expect(screen.getByText('Google')).toBeInTheDocument()
    })

    it('should render error section when error plugins exist', () => {
      const { container } = render(<PluginTaskList {...defaultProps} errorPlugins={errorPlugins} />)

      const headers = container.querySelectorAll('.system-sm-semibold-uppercase')
      expect(headers).toHaveLength(1)
      expect(headers[0].textContent).toContain('plugin.task.installedError')
      expect(screen.getByText('DALLE')).toBeInTheDocument()
    })

    it('should render all three sections simultaneously', () => {
      render(
        <PluginTaskList
          {...defaultProps}
          runningPlugins={runningPlugins}
          successPlugins={successPlugins}
          errorPlugins={errorPlugins}
        />,
      )

      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Google')).toBeInTheDocument()
      expect(screen.getByText('DALLE')).toBeInTheDocument()
    })
  })

  describe('Clear actions', () => {
    it('should show Clear all button in success section', () => {
      render(<PluginTaskList {...defaultProps} successPlugins={successPlugins} />)

      const clearButtons = screen.getAllByText(/plugin\.task\.clearAll/)
      expect(clearButtons).toHaveLength(1)
    })

    it('should call onClearAll when success section Clear all is clicked', () => {
      const onClearAll = vi.fn()
      render(
        <PluginTaskList
          {...defaultProps}
          successPlugins={successPlugins}
          onClearAll={onClearAll}
        />,
      )

      fireEvent.click(screen.getByText(/plugin\.task\.clearAll/))
      expect(onClearAll).toHaveBeenCalledTimes(1)
    })

    it('should show Clear all button in error section', () => {
      render(<PluginTaskList {...defaultProps} errorPlugins={errorPlugins} />)

      const clearButtons = screen.getAllByText(/plugin\.task\.clearAll/)
      expect(clearButtons).toHaveLength(1)
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

      fireEvent.click(screen.getByText(/plugin\.task\.clearAll/))
      expect(onClearErrors).toHaveBeenCalledTimes(1)
    })

    it('should call onClearSingle from success section clear button', () => {
      const onClearSingle = vi.fn()
      render(
        <PluginTaskList
          {...defaultProps}
          successPlugins={successPlugins}
          onClearSingle={onClearSingle}
        />,
      )

      // The × close button from PluginItem (rendered inside PluginSection)
      const closeButtons = screen.getAllByRole('button')
      const clearItemBtn = closeButtons.find(btn => !btn.textContent?.includes('plugin.task'))
      if (clearItemBtn)
        fireEvent.click(clearItemBtn)

      expect(onClearSingle).toHaveBeenCalledWith('task-1', 's1')
    })
  })

  describe('Running section', () => {
    it('should not render clear buttons for running plugins', () => {
      render(<PluginTaskList {...defaultProps} runningPlugins={runningPlugins} />)

      // Running section has no headerAction and no onClearSingle
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

      // Find the × close button inside error items (not the "Clear all" button)
      const allButtons = screen.getAllByRole('button')
      const clearItemBtn = allButtons.find(btn =>
        !btn.textContent?.includes('plugin.task')
        && !btn.textContent?.includes('installFrom'),
      )
      if (clearItemBtn)
        fireEvent.click(clearItemBtn)

      expect(onClearSingle).toHaveBeenCalledWith('task-1', 'e1')
    })
  })

  describe('Edge Cases', () => {
    it('should not render sections for empty plugin arrays', () => {
      const { container } = render(
        <PluginTaskList
          {...defaultProps}
          runningPlugins={[]}
          successPlugins={[]}
          errorPlugins={[]}
        />,
      )

      expect(container.querySelector('.w-\\[360px\\]')!.children).toHaveLength(0)
    })

    it('should render error section with multiple error plugins', () => {
      const multipleErrors = [
        createPlugin('e1', 'PluginA', { status: TaskStatus.failed, plugin_id: 'org/a' }),
        createPlugin('e2', 'PluginB', { status: TaskStatus.failed, plugin_id: 'https://github.com/b' }),
        createPlugin('e3', 'PluginC', { status: TaskStatus.failed, plugin_id: 'local-only' }),
      ]

      render(<PluginTaskList {...defaultProps} errorPlugins={multipleErrors} />)

      expect(screen.getByText('PluginA')).toBeInTheDocument()
      expect(screen.getByText('PluginB')).toBeInTheDocument()
      expect(screen.getByText('PluginC')).toBeInTheDocument()
    })
  })
})
