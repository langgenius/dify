import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { PluginTriggerNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

const nodeDefault: NodeDefault<PluginTriggerNodeType> = {
  defaultValue: {
    plugin_id: '',
    plugin_name: '',
    event_type: '',
    config: {},
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    return []
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes.filter(type => type !== BlockEnum.Start)
  },
  checkValid(payload: PluginTriggerNodeType, t: any) {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
