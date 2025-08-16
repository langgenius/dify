import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleTriggerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.triggerSchedule'

const Panel: FC<NodePanelProps<ScheduleTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-2'>
        <Field title={t(`${i18nPrefix}.title`)}>
          <div className="text-sm text-gray-500">
            {t(`${i18nPrefix}.configPlaceholder`)}
          </div>
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
