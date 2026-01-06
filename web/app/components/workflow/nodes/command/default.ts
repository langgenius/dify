import type { NodeDefault } from '../../types'
import type { CommandNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const i18nPrefix = 'errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Utilities,
  sort: 2,
  type: BlockEnum.Command,
})

const nodeDefault: NodeDefault<CommandNodeType> = {
  metaData,
  defaultValue: {
    working_directory: '',
    command: '',
  },
  checkValid(payload: CommandNodeType, t: any) {
    let errorMessages = ''
    const { command } = payload

    if (!errorMessages && !command)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.command`, { ns: 'workflow' }) })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
