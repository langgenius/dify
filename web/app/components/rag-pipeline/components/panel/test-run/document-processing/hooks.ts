import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import type { FormData } from './options'
import { useTranslation } from 'react-i18next'

export const useConfigurations = () => {
    const { t } = useTranslation()
    const maxValue = Number.parseInt(globalThis.document?.body?.getAttribute('data-public-indexing-max-segmentation-tokens-length') || '4000', 10)

    const configurations: BaseConfiguration<FormData>[] = [
      {
        type: BaseFieldType.textInput,
        variable: 'separator',
        label: t('datasetCreation.stepTwo.separator'),
        required: false,
        showConditions: [],
        placeholder: t('datasetCreation.stepTwo.separatorPlaceholder'),
        tooltip: t('datasetCreation.stepTwo.separatorTip'),
      },
      {
        type: BaseFieldType.numberInput,
        variable: 'max_tokens',
        label: t('datasetCreation.stepTwo.maxLength'),
        required: false,
        min: 1,
        max: maxValue,
        showConditions: [],
        placeholder: `≤ ${maxValue}`,
      },
      {
        type: BaseFieldType.numberInput,
        variable: 'chunk_overlap',
        label: t('datasetCreation.stepTwo.overlap'),
        required: false,
        min: 1,
        showConditions: [],
        placeholder: t('datasetCreation.stepTwo.overlap') || '',
        tooltip: t('datasetCreation.stepTwo.overlapTip'),
      },
      {
        type: BaseFieldType.checkbox,
        variable: 'remove_extra_spaces',
        label: t('datasetCreation.stepTwo.removeExtraSpaces'),
        required: false,
        showConditions: [],
      },
      {
        type: BaseFieldType.checkbox,
        variable: 'remove_urls_emails',
        label: t('datasetCreation.stepTwo.removeUrlEmails'),
        required: false,
        showConditions: [],
      },
    ]

    return configurations
}
