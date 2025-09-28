import type { FC } from 'react'
import React from 'react'
import type { Category } from '../index'
import { useTranslation } from 'react-i18next'
import { Cloud, SelfHosted } from '../assets'
import Tab from './tab'
import Divider from '@/app/components/base/divider'
import type { PlanRange } from './plan-range-switcher'
import PlanRangeSwitcher from './plan-range-switcher'

type PlanSwitcherProps = {
  currentCategory: Category
  currentPlanRange: PlanRange
  onChangeCategory: (category: Category) => void
  onChangePlanRange: (value: PlanRange) => void
}

const PlanSwitcher: FC<PlanSwitcherProps> = ({
  currentCategory,
  currentPlanRange,
  onChangeCategory,
  onChangePlanRange,
}) => {
  const { t } = useTranslation()
  const isCloud = currentCategory === 'cloud'

  const tabs = {
    cloud: {
      value: 'cloud' as Category,
      label: t('billing.plansCommon.cloud'),
      Icon: Cloud,
    },
    self: {
      value: 'self' as Category,
      label: t('billing.plansCommon.self'),
      Icon: SelfHosted,
    },
  }

  return (
    <div className='flex w-full justify-center border-t border-divider-accent px-10'>
      <div className='flex max-w-[1680px] grow items-center justify-between border-x border-divider-accent p-1'>
        <div className='flex items-center'>
          <Tab<Category>
            {...tabs.cloud}
            isActive={currentCategory === tabs.cloud.value}
            onClick={onChangeCategory}
          />
          <Divider type='vertical' className='mx-2 h-4 bg-divider-accent' />
          <Tab<Category>
            {...tabs.self}
            isActive={currentCategory === tabs.self.value}
            onClick={onChangeCategory}
          />
        </div>
        {isCloud && (
          <PlanRangeSwitcher
            value={currentPlanRange}
            onChange={onChangePlanRange}
          />
        )}
      </div>
    </div>
  )
}

export default React.memo(PlanSwitcher)
