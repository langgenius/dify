import type { NodeDefault } from '../../types'
import type { StartPlaceholderNodeType } from './types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const metaData = genNodeMetaData({
  sort: 0.05,
  type: BlockEnum.StartPlaceholder,
  isRequired: false,
  isSingleton: true,
  isTypeFixed: true,
  helpLinkUri: 'user-input',
})

const nodeDefault: NodeDefault<StartPlaceholderNodeType> = {
  metaData,
  defaultValue: {
    title: 'Workflow start',
    desc: '',
  },
  checkValid(_payload, t) {
    return {
      isValid: false,
      errorMessage: t('nodes.startPlaceholder.validationRequired', { ns: 'workflow' }),
    }
  },
}

export default nodeDefault
