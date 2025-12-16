import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { produce } from 'immer'
import { useContext } from 'use-context-selector'
import { RiEqualizer2Line } from '@remixicon/react'
import { ContentModeration } from '@/app/components/base/icons/src/vender/features'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import Button from '@/app/components/base/button'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { FeatureEnum } from '@/app/components/base/features/types'
import { fetchCodeBasedExtensionList } from '@/service/common'
import { useModalContext } from '@/context/modal-context'
import I18n from '@/context/i18n'

type Props = {
  disabled?: boolean
  onChange?: OnFeaturesChange
}

const Moderation = ({
  disabled,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const { setShowModerationSettingModal } = useModalContext()
  const { locale } = useContext(I18n)
  const featuresStore = useFeaturesStore()
  const moderation = useFeatures(s => s.features.moderation)
  const { data: codeBasedExtensionList } = useSWR(
    '/code-based-extension?module=moderation',
    fetchCodeBasedExtensionList,
  )
  const [isHovering, setIsHovering] = useState(false)

  const handleOpenModerationSettingModal = () => {
    if (disabled)
      return

    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    setShowModerationSettingModal({
      payload: moderation as any,
      onSaveCallback: (newModeration) => {
        const newFeatures = produce(features, (draft) => {
          draft.moderation = newModeration
        })
        setFeatures(newFeatures)
        if (onChange)
          onChange(newFeatures)
      },
      onCancelCallback: () => {
        if (onChange)
          onChange()
      },
    })
  }

  const handleChange = useCallback((type: FeatureEnum, enabled: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    if (enabled && !features.moderation?.type && type === FeatureEnum.moderation) {
      setShowModerationSettingModal({
        payload: {
          enabled: true,
          type: 'keywords',
          config: {
            keywords: '',
            inputs_config: {
              enabled: true,
              preset_response: '',
            },
          },
        },
        onSaveCallback: (newModeration) => {
          const newFeatures = produce(features, (draft) => {
            draft.moderation = newModeration
          })
          setFeatures(newFeatures)
          if (onChange)
            onChange(newFeatures)
        },
        onCancelCallback: () => {
          const newFeatures = produce(features, (draft) => {
            draft.moderation = { enabled: false }
          })
          setFeatures(newFeatures)
          if (onChange)
            onChange()
        },
      })
    }

    if (!enabled) {
      const newFeatures = produce(features, (draft) => {
        draft.moderation = { enabled: false }
      })
      setFeatures(newFeatures)
      if (onChange)
        onChange(newFeatures)
    }
  }, [featuresStore, onChange, setShowModerationSettingModal])

  const providerContent = useMemo(() => {
    if (moderation?.type === 'openai_moderation')
      return t('appDebug.feature.moderation.modal.provider.openai')
    else if (moderation?.type === 'keywords')
      return t('appDebug.feature.moderation.modal.provider.keywords')
    else if (moderation?.type === 'api')
      return t('common.apiBasedExtension.selector.title')
    else
      return codeBasedExtensionList?.data.find(item => item.name === moderation?.type)?.label[locale] || '-'
  }, [codeBasedExtensionList?.data, locale, moderation?.type, t])

  const enableContent = useMemo(() => {
    if (moderation?.config?.inputs_config?.enabled && moderation.config?.outputs_config?.enabled)
      return t('appDebug.feature.moderation.allEnabled')
    else if (moderation?.config?.inputs_config?.enabled)
      return t('appDebug.feature.moderation.inputEnabled')
    else if (moderation?.config?.outputs_config?.enabled)
      return t('appDebug.feature.moderation.outputEnabled')
  }, [moderation?.config?.inputs_config?.enabled, moderation?.config?.outputs_config?.enabled, t])

  return (
    <FeatureCard
      icon={
        <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-text-success p-1 shadow-xs'>
          <ContentModeration className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      }
      title={t('appDebug.feature.moderation.title')}
      value={!!moderation?.enabled}
      onChange={state => handleChange(FeatureEnum.moderation, state)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      disabled={disabled}
    >
      <>
        {!moderation?.enabled && (
          <div className='system-xs-regular line-clamp-2 min-h-8 text-text-tertiary'>{t('appDebug.feature.moderation.description')}</div>
        )}
        {!!moderation?.enabled && (
          <>
            {!isHovering && (
              <div className='flex items-center gap-4 pt-0.5'>
                <div className=''>
                  <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('appDebug.feature.moderation.modal.provider.title')}</div>
                  <div className='system-xs-regular text-text-secondary'>{providerContent}</div>
                </div>
                <div className='h-[27px] w-px rotate-12 bg-divider-subtle'></div>
                <div className=''>
                  <div className='system-2xs-medium-uppercase mb-0.5 text-text-tertiary'>{t('appDebug.feature.moderation.contentEnableLabel')}</div>
                  <div className='system-xs-regular text-text-secondary'>{enableContent}</div>
                </div>
              </div>
            )}
            {isHovering && (
              <Button className='w-full' onClick={handleOpenModerationSettingModal} disabled={disabled}>
                <RiEqualizer2Line className='mr-1 h-4 w-4' />
                {t('common.operation.settings')}
              </Button>
            )}
          </>
        )}
      </>
    </FeatureCard>
  )
}

export default Moderation
