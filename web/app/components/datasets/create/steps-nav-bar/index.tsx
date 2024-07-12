'use client'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'

import { useCallback } from 'react'
import s from './index.module.css'
import cn from '@/utils/classnames'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

type IStepsNavBarProps = {
  step: number
  datasetId?: string
}

const STEP_T_MAP: Record<number, string> = {
  1: 'datasetCreation.steps.one',
  2: 'datasetCreation.steps.two',
  3: 'datasetCreation.steps.three',
}

const STEP_LIST = [1, 2, 3]

const StepsNavBar = ({
  step,
  datasetId,
}: IStepsNavBarProps) => {
  const { t } = useTranslation()
  const router = useRouter()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const navBackHandle = useCallback(() => {
    if (!datasetId)
      router.replace('/datasets')
    else
      router.replace(`/datasets/${datasetId}/documents`)
  }, [router, datasetId])

  return (
    <div className='w-full pt-4'>
      <div className={cn(s.stepsHeader, isMobile && '!px-0 justify-center')}>
        <div onClick={navBackHandle} className={cn(s.navBack, isMobile && '!mr-0')} />
        {!isMobile && (!datasetId ? t('datasetCreation.steps.header.creation') : t('datasetCreation.steps.header.update'))}
      </div>
      <div className={cn(s.stepList, isMobile && '!p-0')}>
        {STEP_LIST.map(item => (
          <div
            key={item}
            className={cn(s.stepItem, s[`step${item}`], step === item && s.active, step > item && s.done, isMobile && 'px-0')}
          >
            <div className={cn(s.stepNum)}>{item}</div>
            <div className={cn(s.stepName)}>{isMobile ? '' : t(STEP_T_MAP[item])}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default StepsNavBar
