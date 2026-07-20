import type { TFunction } from 'i18next'
import type { HumanInputV2NodeType } from './types'
import type { NodeDefault } from '@/app/components/workflow/types'
import { BlockClassification } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import {
  buildHumanInputOutputVars,
  getHumanInputSharedValidationError,
} from '../human-input/shared/default-utils'
import { getRecipientValidationError, hasDuplicateRecipients } from './recipient-utils'
import { isHumanInputV2DebugChannel } from './types'

const metaData = genNodeMetaData({
  classification: BlockClassification.Logic,
  sort: 2,
  type: BlockEnum.HumanInputV2,
  helpLinkUri: 'human-input',
})

const nodeDefault: NodeDefault<HumanInputV2NodeType> = {
  metaData,
  defaultValue: {
    type: BlockEnum.HumanInput,
    version: '2',
    recpients_spec: [],
    message_template: { subject: '', body: '' },
    debug_mode: { enabled: false, channels: [] },
    form_content: '',
    inputs: [],
    user_actions: [],
    timeout: 36,
    timeout_unit: 'hour',
  },
  checkValid(payload, t: TFunction<'workflow'>) {
    let errorMessage = ''
    if (payload.version !== '2')
      errorMessage = t(($) => $['nodes.humanInputV2.error.version'], { ns: 'workflow' })
    else if (!payload.recpients_spec.length)
      errorMessage = t(($) => $['nodes.humanInputV2.error.recipientRequired'], { ns: 'workflow' })
    else if (payload.recpients_spec.some(getRecipientValidationError))
      errorMessage = t(($) => $['nodes.humanInputV2.error.recipientInvalid'], { ns: 'workflow' })
    else if (hasDuplicateRecipients(payload.recpients_spec))
      errorMessage = t(($) => $['nodes.humanInputV2.error.recipientDuplicate'], { ns: 'workflow' })
    else if (!payload.message_template.subject.trim())
      errorMessage = t(($) => $['nodes.humanInputV2.error.subjectRequired'], { ns: 'workflow' })
    else if (!payload.message_template.body.trim())
      errorMessage = t(($) => $['nodes.humanInputV2.error.bodyRequired'], { ns: 'workflow' })
    else if (
      payload.debug_mode.enabled &&
      !payload.debug_mode.channels.some(isHumanInputV2DebugChannel)
    )
      errorMessage = t(($) => $['nodes.humanInputV2.error.debugChannelRequired'], {
        ns: 'workflow',
      })
    else errorMessage = getHumanInputSharedValidationError(payload, t)

    return { isValid: !errorMessage, errorMessage }
  },
  getOutputVars(payload) {
    return buildHumanInputOutputVars(payload.inputs)
  },
}

export default nodeDefault
