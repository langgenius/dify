'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import UpgradeBtn from '../upgrade-btn'
import { ArtificialBrain } from '../../base/icons/src/vender/line/development'
import UsageInfo from '../usage-info'
import s from './style.module.css'
import { useProviderContext } from '@/context/provider-context'

const VectorSpaceFull: FC = () => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { total } = plan

  return (
    <div className='border border-gray-200 rounded-xl py-5 px-6'>
      <div className='flex justify-between items-center'>
        <div className={cn(s.textGradient, 'leading-[24px] text-base font-semibold')}>
          <div>{t('billing.vectorSpace.fullTip')}</div>
          <div>{t('billing.vectorSpace.fullSolution')}</div>
        </div>
        <UpgradeBtn />
      </div>
      <UsageInfo
        className='pt-4'
        Icon={ArtificialBrain}
        name={t('billing.plansCommon.vectorSpace')}
        tooltip={t('billing.plansCommon.vectorSpaceTooltip') as string}
        usage={total.vectorSpace}
        total={total.vectorSpace}
        unit='MB'
      />
    </div>
  )
}
export default React.memo(VectorSpaceFull)
