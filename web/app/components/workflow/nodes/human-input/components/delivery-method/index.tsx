import React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import MethodSelector from './method-selector'
import type { DeliveryMethod } from '../../types'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  value: DeliveryMethod[]
}

const DeliveryMethodForm: React.FC<Props> = ({ value }) => {
  const { t } = useTranslation()

  return (
    <div className='px-4 py-2'>
        <div className='mb-1 flex items-center justify-between'>
          <div className='flex items-center gap-0.5'>
            <div className='system-sm-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.deliveryMethod.title`)}</div>
            <Tooltip
              popupContent={t(`${i18nPrefix}.deliveryMethod.tooltip`)}
            />
          </div>
          <div className='flex items-center px-1'>
            <MethodSelector
              data={value}
            />
          </div>
        </div>
        <div className='system-xs-regular flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.emptyTip`)}</div>
      </div>
  )
}

export default DeliveryMethodForm
