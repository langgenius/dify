import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { RiEqualizer2Line, RiImage2Fill } from '@remixicon/react'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import SettingModal from '@/app/components/base/features/new-feature-panel/file-upload/setting-modal'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { FeatureEnum } from '@/app/components/base/features/types'

type Props = {
  disabled: boolean
  onChange?: OnFeaturesChange
}

const FileUpload = ({
  disabled,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const file = useFeatures(s => s.features.file)
  const featuresStore = useFeaturesStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [isHovering, setIsHovering] = useState(false)

  const supportedTypes = useMemo(() => {
    return file?.allowed_file_types?.join(',') || '-'
  }, [file?.allowed_file_types])

  const handleChange = useCallback((type: FeatureEnum, enabled: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft[type] = {
        ...draft[type],
        enabled,
        image: { enabled },
      }
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange()
  }, [featuresStore, onChange])

  return (
    <FeatureCard
      icon={
        <div className='shrink-0 p-1 rounded-lg border-[0.5px] border-divider-subtle shadow-xs bg-util-colors-indigo-indigo-600'>
          <RiImage2Fill className='w-4 h-4 text-text-primary-on-surface' />
        </div>
      }
      title={
        <div className='flex items-center'>
          {t('appDebug.feature.imageUpload.title')}
          <Badge
            text='LEGACY'
            className='shrink-0 mx-1 border-text-accent-secondary text-text-accent-secondary'
          />
        </div>
      }
      value={file?.enabled}
      onChange={state => handleChange(FeatureEnum.file, state)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      disabled={disabled}
    >
      <>
        {!file?.enabled && (
          <div className='min-h-8 text-text-tertiary system-xs-regular line-clamp-2'>{t('appDebug.feature.imageUpload.description')}</div>
        )}
        {file?.enabled && (
          <>
            {!isHovering && !modalOpen && (
              <div className='pt-0.5 flex items-center gap-4'>
                <div className=''>
                  <div className='mb-0.5 text-text-tertiary system-2xs-medium-uppercase'>{t('appDebug.feature.imageUpload.supportedTypes')}</div>
                  <div className='text-text-secondary system-xs-regular'>{supportedTypes}</div>
                </div>
                <div className='w-px h-[27px] bg-divider-subtle rotate-12'></div>
                <div className=''>
                  <div className='mb-0.5 text-text-tertiary system-2xs-medium-uppercase'>{t('appDebug.feature.imageUpload.numberLimit')}</div>
                  <div className='text-text-secondary system-xs-regular'>{file?.number_limits}</div>
                </div>
              </div>
            )}
            {(isHovering || modalOpen) && (
              <SettingModal
                imageUpload
                open={modalOpen && !disabled}
                onOpen={(v) => {
                  setModalOpen(v)
                  setIsHovering(v)
                }}
                onChange={onChange}
              >
                <Button className='w-full' disabled={disabled}>
                  <RiEqualizer2Line className='mr-1 w-4 h-4' />
                  {t('common.operation.settings')}
                </Button>
              </SettingModal>
            )}
          </>
        )}
      </>
    </FeatureCard>
  )
}

export default FileUpload
