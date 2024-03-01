'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures } from '../hooks'
import FeatureModal from './feature-modal'
import Button from '@/app/components/base/button'
import { Plus02 } from '@/app/components/base/icons/src/vender/line/general'

const ChooseFeature = () => {
  const { t } = useTranslation()
  const showFeaturesModal = useFeatures(s => s.showFeaturesModal)
  const setShowFeaturesModal = useFeatures(s => s.setShowFeaturesModal)
  return (
    <>
      <Button
        className='px-3 py-0 h-8 rounded-lg border border-primary-100 bg-primary-25 shadow-xs text-xs font-semibold text-primary-600'
        onClick={() => setShowFeaturesModal(true)}
      >
        <Plus02 className='mr-1 w-4 h-4' />
        {t('appDebug.operation.addFeature')}
      </Button>
      {
        showFeaturesModal && (
          <FeatureModal />
        )
      }
    </>
  )
}
export default React.memo(ChooseFeature)
