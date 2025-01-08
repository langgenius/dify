import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import useConfig from './use-config'

import type { SleepNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { InputNumber } from '@/app/components/base/input-number'

const i18nPrefix = 'workflow.nodes.sleep'

const Panel: FC<NodePanelProps<SleepNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    inputs,
    handleSleepTimeChange,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.sleepTime`)}
        >
          <>
            <InputNumber
              min={1}
              max={60 * 1000}
              value={inputs.sleep_time_ms}
              onChange={handleSleepTimeChange}
              style={{ width: '100%' }}
              placeholder={t(`${i18nPrefix}.sleepTimeTip`)!}
            />
            <div className="text-sm text-gray-500 mt-2">
              {t(`${i18nPrefix}.sleepTimeTip`)}
            </div>
          </>
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
