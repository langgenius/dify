import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { ScheduleTriggerNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

const nodeDefault: NodeDefault<ScheduleTriggerNodeType> = {
  defaultValue: {
    mode: 'visual',
    frequency: 'daily',
    cron_expression: '',
    visual_config: {
      time: '11:30 AM',
      weekdays: ['sun'],
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabled: true,
  },
  getAvailablePrevNodes(_isChatMode: boolean) {
    return []
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes.filter(type => type !== BlockEnum.Start)
  },
  checkValid(_payload: ScheduleTriggerNodeType, _t: any) {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
