'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import { useFeatures } from '../hooks'
import type { OnFeaturesChange } from '../types'
import FeatureModal from './feature-modal'
import Button from '@/app/components/base/button'

type ChooseFeatureProps = {
  onChange?: OnFeaturesChange
  disabled?: boolean
}
const ChooseFeature = ({
  onChange,
  disabled,
}: ChooseFeatureProps) => {
  const { t } = useTranslation()
  const showFeaturesModal = useFeatures(s => s.showFeaturesModal)
  const setShowFeaturesModal = useFeatures(s => s.setShowFeaturesModal)
  return (
    <>
      <Button
        className={`
          border-primary-100 bg-primary-25 text-xs font-semibold text-primary-600
        `}
        onClick={() => !disabled && setShowFeaturesModal(true)}
      >
        <RiAddLine className='mr-1 w-4 h-4' />
        {t('appDebug.operation.addFeature')}
      </Button>
      {
        showFeaturesModal && (
          <FeatureModal onChange={onChange} />
        )
      }
    </>
  )
}
export default React.memo(ChooseFeature)
