import type { AppDetailResponse } from '@/models/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import TriggerCard from './trigger-card'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (options?.count !== undefined)
        return `${key} (${options.count})`
      return key
    },
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

const mockSetTriggerStatus = vi.fn()
const mockSetTriggerStatuses = vi.fn()
vi.mock('@/app/components/workflow/store/trigger-status', () => ({
  useTriggerStatusStore: () => ({
    setTriggerStatus: mockSetTriggerStatus,
    setTriggerStatuses: mockSetTriggerStatuses,
  }),
}))

const mockUpdateTriggerStatus = vi.fn()
const mockInvalidateAppTriggers = vi.fn()
let mockTriggers: Array<{
  id: string
  node_id: string
  title: string
  trigger_type: string
  status: string
  provider_name?: string
}> = []
let mockIsLoading = false

vi.mock('@/service/use-tools', () => ({
  useAppTriggers: () => ({
    data: { data: mockTriggers },
    isLoading: mockIsLoading,
  }),
  useUpdateTriggerStatus: () => ({
    mutateAsync: mockUpdateTriggerStatus,
  }),
  useInvalidateAppTriggers: () => mockInvalidateAppTriggers,
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({
    data: [
      { id: 'plugin-1', name: 'Test Plugin', icon: 'test-icon' },
    ],
  }),
}))

vi.mock('@/utils', () => ({
  canFindTool: () => false,
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ type }: { type: string }) => (
    <div data-testid="block-icon" data-type={type}>BlockIcon</div>
  ),
}))

vi.mock('@/app/components/base/switch', () => ({
  default: ({ defaultValue, onChange, disabled }: { defaultValue: boolean, onChange: (v: boolean) => void, disabled: boolean }) => (
    <button
      data-testid="switch"
      data-checked={defaultValue ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      onClick={() => onChange(!defaultValue)}
    >
      Switch
    </button>
  ),
}))

describe('TriggerCard', () => {
  const mockAppInfo = {
    id: 'test-app-id',
    name: 'Test App',
    description: 'Test description',
    mode: AppModeEnum.WORKFLOW,
    icon_type: 'emoji',
    icon: 'test-icon',
    icon_background: '#ffffff',
    created_at: Date.now(),
    updated_at: Date.now(),
    enable_site: true,
    enable_api: true,
  } as AppDetailResponse

  const mockOnToggleResult = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockTriggers = []
    mockIsLoading = false
    mockUpdateTriggerStatus.mockResolvedValue({})
  })

  describe('Loading State', () => {
    it('should render loading skeleton when isLoading is true', () => {
      mockIsLoading = true

      const { container } = render(
        <TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />,
      )

      expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should show no triggers added message when triggers is empty', () => {
      mockTriggers = []

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      expect(screen.getByText('overview.triggerInfo.noTriggerAdded')).toBeInTheDocument()
    })

    it('should show trigger status description when no triggers', () => {
      mockTriggers = []

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      expect(screen.getByText('overview.triggerInfo.triggerStatusDescription')).toBeInTheDocument()
    })

    it('should show learn more link when no triggers', () => {
      mockTriggers = []

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const learnMoreLink = screen.getByText('overview.triggerInfo.learnAboutTriggers')
      expect(learnMoreLink).toBeInTheDocument()
      expect(learnMoreLink).toHaveAttribute('href', 'https://docs.example.com/use-dify/nodes/trigger/overview')
    })
  })

  describe('With Triggers', () => {
    beforeEach(() => {
      mockTriggers = [
        {
          id: 'trigger-1',
          node_id: 'node-1',
          title: 'Webhook Trigger',
          trigger_type: 'trigger-webhook',
          status: 'enabled',
        },
        {
          id: 'trigger-2',
          node_id: 'node-2',
          title: 'Schedule Trigger',
          trigger_type: 'trigger-schedule',
          status: 'disabled',
        },
      ]
    })

    it('should show triggers count message', () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      expect(screen.getByText('overview.triggerInfo.triggersAdded (2)')).toBeInTheDocument()
    })

    it('should render trigger titles', () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      expect(screen.getByText('Webhook Trigger')).toBeInTheDocument()
      expect(screen.getByText('Schedule Trigger')).toBeInTheDocument()
    })

    it('should show running status for enabled triggers', () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      expect(screen.getByText('overview.status.running')).toBeInTheDocument()
    })

    it('should show disable status for disabled triggers', () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      expect(screen.getByText('overview.status.disable')).toBeInTheDocument()
    })

    it('should render block icons for each trigger', () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const blockIcons = screen.getAllByTestId('block-icon')
      expect(blockIcons.length).toBe(2)
    })

    it('should render switches for each trigger', () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const switches = screen.getAllByTestId('switch')
      expect(switches.length).toBe(2)
    })
  })

  describe('Toggle Trigger', () => {
    beforeEach(() => {
      mockTriggers = [
        {
          id: 'trigger-1',
          node_id: 'node-1',
          title: 'Test Trigger',
          trigger_type: 'trigger-webhook',
          status: 'disabled',
        },
      ]
    })

    it('should call updateTriggerStatus when toggle is clicked', async () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const switchBtn = screen.getByTestId('switch')
      fireEvent.click(switchBtn)

      await waitFor(() => {
        expect(mockUpdateTriggerStatus).toHaveBeenCalledWith({
          appId: 'test-app-id',
          triggerId: 'trigger-1',
          enableTrigger: true,
        })
      })
    })

    it('should update trigger status in store optimistically', async () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const switchBtn = screen.getByTestId('switch')
      fireEvent.click(switchBtn)

      await waitFor(() => {
        expect(mockSetTriggerStatus).toHaveBeenCalledWith('node-1', 'enabled')
      })
    })

    it('should invalidate app triggers after successful update', async () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const switchBtn = screen.getByTestId('switch')
      fireEvent.click(switchBtn)

      await waitFor(() => {
        expect(mockInvalidateAppTriggers).toHaveBeenCalledWith('test-app-id')
      })
    })

    it('should call onToggleResult with null on success', async () => {
      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const switchBtn = screen.getByTestId('switch')
      fireEvent.click(switchBtn)

      await waitFor(() => {
        expect(mockOnToggleResult).toHaveBeenCalledWith(null)
      })
    })

    it('should rollback status and call onToggleResult with error on failure', async () => {
      const error = new Error('Update failed')
      mockUpdateTriggerStatus.mockRejectedValueOnce(error)

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const switchBtn = screen.getByTestId('switch')
      fireEvent.click(switchBtn)

      await waitFor(() => {
        expect(mockSetTriggerStatus).toHaveBeenCalledWith('node-1', 'disabled')
        expect(mockOnToggleResult).toHaveBeenCalledWith(error)
      })
    })
  })

  describe('Trigger Types', () => {
    it('should render webhook trigger type correctly', () => {
      mockTriggers = [
        {
          id: 'trigger-1',
          node_id: 'node-1',
          title: 'Webhook',
          trigger_type: 'trigger-webhook',
          status: 'enabled',
        },
      ]

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-type', 'trigger-webhook')
    })

    it('should render schedule trigger type correctly', () => {
      mockTriggers = [
        {
          id: 'trigger-1',
          node_id: 'node-1',
          title: 'Schedule',
          trigger_type: 'trigger-schedule',
          status: 'enabled',
        },
      ]

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-type', 'trigger-schedule')
    })

    it('should render plugin trigger type correctly', () => {
      mockTriggers = [
        {
          id: 'trigger-1',
          node_id: 'node-1',
          title: 'Plugin',
          trigger_type: 'trigger-plugin',
          status: 'enabled',
          provider_name: 'plugin-1',
        },
      ]

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-type', 'trigger-plugin')
    })
  })

  describe('Editor Permissions', () => {
    it('should render switches for triggers', () => {
      mockTriggers = [
        {
          id: 'trigger-1',
          node_id: 'node-1',
          title: 'Test Trigger',
          trigger_type: 'trigger-webhook',
          status: 'enabled',
        },
      ]

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      const switchBtn = screen.getByTestId('switch')
      expect(switchBtn).toBeInTheDocument()
    })
  })

  describe('Status Sync', () => {
    it('should sync trigger statuses to store when data loads', () => {
      mockTriggers = [
        {
          id: 'trigger-1',
          node_id: 'node-1',
          title: 'Test',
          trigger_type: 'trigger-webhook',
          status: 'enabled',
        },
        {
          id: 'trigger-2',
          node_id: 'node-2',
          title: 'Test 2',
          trigger_type: 'trigger-schedule',
          status: 'disabled',
        },
      ]

      render(<TriggerCard appInfo={mockAppInfo} onToggleResult={mockOnToggleResult} />)

      expect(mockSetTriggerStatuses).toHaveBeenCalledWith({
        'node-1': 'enabled',
        'node-2': 'disabled',
      })
    })
  })
})
