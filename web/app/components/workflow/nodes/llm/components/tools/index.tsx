import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import Field from '@/app/components/workflow/nodes/_base/components/field'

const i18nPrefix = 'workflow.nodes.llm'

const Tools = () => {
  const { t } = useTranslation()

  return (
    <Field
      title={t(`${i18nPrefix}.tools.title`)}
      tooltip={t('appDebug.vision.description')!}
      operations={(
        <Tooltip
          popupContent={t('appDebug.vision.onlySupportVisionModelTip')!}
        >
        </Tooltip>
      )}
    >
      <div>
        <div>Tools</div>
      </div>
    </Field>
  )
}

export default memo(Tools)
