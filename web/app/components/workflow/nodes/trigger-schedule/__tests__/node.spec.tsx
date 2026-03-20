import type { ScheduleTriggerNodeType } from '../types'
import { screen } from '@testing-library/react'
import { renderNodeComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'
import { getNextExecutionTime } from '../utils/execution-time-calculator'

const createNodeData = (overrides: Partial<ScheduleTriggerNodeType> = {}): ScheduleTriggerNodeType => ({
  title: 'Schedule Trigger',
  desc: '',
  type: BlockEnum.TriggerSchedule,
  mode: 'visual',
  frequency: 'daily',
  timezone: 'UTC',
  visual_config: {
    time: '11:30 AM',
  },
  ...overrides,
})

describe('TriggerScheduleNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The node should surface the computed next execution time for both valid and invalid schedules.
  describe('Rendering', () => {
    it('should render the next execution label and computed execution time', () => {
      const data = createNodeData()

      renderNodeComponent(Node, data)

      expect(screen.getByText('workflow.nodes.triggerSchedule.nextExecutionTime')).toBeInTheDocument()
      expect(screen.getByText(getNextExecutionTime(data))).toBeInTheDocument()
    })

    it('should render the placeholder when cron mode has an invalid expression', () => {
      renderNodeComponent(Node, createNodeData({
        mode: 'cron',
        cron_expression: 'invalid cron',
      }))

      expect(screen.getByText('--')).toBeInTheDocument()
    })
  })
})
