import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { BaseFieldType } from '@/app/components/base/form/form-scenarios/base/types'
import { useTranslation } from 'react-i18next'
import type { FormData } from './options'
import { z } from 'zod'

const ERROR_I18N_PREFIX = 'common.errorMsg'
const I18N_PREFIX = 'datasetCreation.stepOne.website'

export const useConfigurations = () => {
    const { t } = useTranslation()
    const configurations: BaseConfiguration<FormData>[] = [
      {
        type: BaseFieldType.textInput,
        variable: 'url',
        label: 'URL',
        required: true,
        showConditions: [],
        placeholder: 'https://docs.dify.ai',
      },
      {
        type: BaseFieldType.numberInput,
        variable: 'limit',
        label: t(`${I18N_PREFIX}.limit`),
        required: false,
        showConditions: [],
      },
      {
        type: BaseFieldType.numberInput,
        variable: 'max_depth',
        label: t(`${I18N_PREFIX}.maxDepth`),
        required: false,
        showConditions: [],
      },
      {
        type: BaseFieldType.textInput,
        variable: 'excludes',
        label: t(`${I18N_PREFIX}.excludePaths`),
        required: false,
        showConditions: [],
      placeholder: 'blog/*, /about/*',
      },
      {
        type: BaseFieldType.textInput,
        variable: 'includes',
        label: t(`${I18N_PREFIX}.includeOnlyPaths`),
        required: false,
        showConditions: [],
        placeholder: 'articles/*',
      },
      {
        type: BaseFieldType.checkbox,
        variable: 'crawl_sub_pages',
        label: t(`${I18N_PREFIX}.crawlSubPage`),
        required: false,
        showConditions: [],
      },
      {
        type: BaseFieldType.checkbox,
        variable: 'only_main_content',
        label: t(`${I18N_PREFIX}.extractOnlyMainContent`),
        required: false,
        showConditions: [],
      },
    ]

    return configurations
}

export const useSchema = () => {
  const { t } = useTranslation()

  const Schema = z.object({
    url: z.string().nonempty({
      message: t(`${ERROR_I18N_PREFIX}.fieldRequired`, {
        field: 'url',
      }),
    }).regex(/^https?:\/\//, {
      message: t(`${ERROR_I18N_PREFIX}.urlError`),
    }),
    limit: z.number().positive({
      message: t(`${ERROR_I18N_PREFIX}.fieldRequired`, {
        field: t(`${I18N_PREFIX}.limit`),
      }),
    }).int(),
  }).passthrough()

  return Schema
}
