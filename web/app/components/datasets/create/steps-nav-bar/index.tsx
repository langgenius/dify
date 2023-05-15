'use client'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'

import cn from 'classnames'
import s from './index.module.css'

type IStepsNavBarProps = {
  step: number,
  datasetId?: string,
}

const StepsNavBar = ({
  step,
  datasetId,
}: IStepsNavBarProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const navBackHandle = () => {
    if (!datasetId) {
      router.replace('/datasets')
    } else {
      router.replace(`/datasets/${datasetId}/documents`)
    }
  }

  return (
    <div className='w-full pt-4'>
      <div className={s.stepsHeader}>
        <div onClick={navBackHandle} className={s.navBack} />
        {!datasetId ? t('datasetCreation.steps.header.creation') : t('datasetCreation.steps.header.update')}
      </div>
      <div className={cn(s.stepList)}>
        <div className={cn(s.stepItem, s.step1, step === 1 && s.active, step !== 1 && s.done)}>
          <div className={cn(s.stepNum)}>{step === 1 ? 1 : ''}</div>
          <div className={cn(s.stepName)}>{t('datasetCreation.steps.one')}</div>
        </div>
        <div className={cn(s.stepItem, s.step2, step === 2 && s.active, step === 3 && s.done)}>
          <div className={cn(s.stepNum)}>{step !== 3 ? 2 : ''}</div>
          <div className={cn(s.stepName)}>{t('datasetCreation.steps.two')}</div>
        </div>
        <div className={cn(s.stepItem, s.step3, step === 3 && s.active)}>
          <div className={cn(s.stepNum)}>3</div>
          <div className={cn(s.stepName)}>{t('datasetCreation.steps.three')}</div>
        </div>
      </div>
    </div>
  )
}

export default StepsNavBar
