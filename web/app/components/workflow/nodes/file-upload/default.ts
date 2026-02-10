import type { NodeDefault } from '../../types'
import type { FileUploadNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const i18nPrefix = 'errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Utilities,
  sort: 3,
  type: BlockEnum.FileUpload,
})

const nodeDefault: NodeDefault<FileUploadNodeType> = {
  metaData,
  defaultValue: {
    variable_selector: [],
    is_array_file: false,
  },
  checkValid(payload: FileUploadNodeType, t: (key: string, options?: Record<string, unknown>) => string) {
    let errorMessages = ''
    const { variable_selector: variable } = payload

    if (!errorMessages && !variable?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.fileVariable`, { ns: 'workflow' }) })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
