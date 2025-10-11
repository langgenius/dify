import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { RiEqualizer2Line } from '@remixicon/react'
import { FolderUpload } from '@/app/components/base/icons/src/vender/features'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import SettingModal from '@/app/components/base/features/new-feature-panel/file-upload/setting-modal'
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
        <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-600 p-1 shadow-xs'>
          <FolderUpload className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      }
      title={t('appDebug.feature.fileUpload.title')}
      value={file?.enabled}
      onChange={state => handleChange(FeatureEnum.file, state)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      disabled={disabled}
    >
      <>
        {!file?.enabled && (
          <div className='system-xs-regular line-clamp-2 min-h-8 text-text-tertiary'>{t('appDebug.feature.fileUpload.description')}</div>
        )}
        {file?.enabled && (
          <>
            {!isHovering && !modalOpen && (
              <div className='flex items-center gap-4 pt-0.5'>
                <div className=''>
                  <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('appDebug.feature.fileUpload.supportedTypes')}</div>
                  <div className='system-xs-regular text-text-secondary'>{supportedTypes}</div>
                </div>
                <div className='h-[27px] w-px rotate-12 bg-divider-subtle'></div>
                <div className=''>
                  <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('appDebug.feature.fileUpload.numberLimit')}</div>
                  <div className='system-xs-regular text-text-secondary'>{file?.number_limits}</div>
                </div>
              </div>
            )}
            {(isHovering || modalOpen) && (
              <SettingModal
                open={modalOpen && !disabled}
                onOpen={(v) => {
                  setModalOpen(v)
                  setIsHovering(v)
                }}
                onChange={onChange}
              >
                <Button className='w-full' disabled={disabled}>
                  <RiEqualizer2Line className='mr-1 h-4 w-4' />
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
