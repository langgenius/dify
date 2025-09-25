import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { genNodeMetaData } from '../../utils'
import type { PluginTriggerNodeType } from './types'

const metaData = genNodeMetaData({
  sort: 1,
  type: BlockEnum.TriggerPlugin,
})

const nodeDefault: NodeDefault<PluginTriggerNodeType> = {
  metaData,
  defaultValue: {
    plugin_id: '',
    trigger_name: '',
    // event_type: '',
    config: {},
  },
  checkValid(_payload: PluginTriggerNodeType, _t: any) {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
