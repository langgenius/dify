import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { RiEqualizer2Line } from '@remixicon/react'
import { produce } from 'immer'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { FeatureEnum } from '@/app/components/base/features/types'
import { ContentModeration } from '@/app/components/base/icons/src/vender/features'
import { useLocale } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { useCodeBasedExtensions } from '@/service/use-common'

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
  const locale = useLocale()
  const featuresStore = useFeaturesStore()
  const moderation = useFeatures(s => s.features.moderation)
  const { data: codeBasedExtensionList } = useCodeBasedExtensions('moderation')
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
      return t('feature.moderation.modal.provider.openai', { ns: 'appDebug' })
    else if (moderation?.type === 'keywords')
      return t('feature.moderation.modal.provider.keywords', { ns: 'appDebug' })
    else if (moderation?.type === 'api')
      return t('apiBasedExtension.selector.title', { ns: 'common' })
    else
      return codeBasedExtensionList?.data.find(item => item.name === moderation?.type)?.label[locale] || '-'
  }, [codeBasedExtensionList?.data, locale, moderation?.type, t])

  const enableContent = useMemo(() => {
    if (moderation?.config?.inputs_config?.enabled && moderation.config?.outputs_config?.enabled)
      return t('feature.moderation.allEnabled', { ns: 'appDebug' })
    else if (moderation?.config?.inputs_config?.enabled)
      return t('feature.moderation.inputEnabled', { ns: 'appDebug' })
    else if (moderation?.config?.outputs_config?.enabled)
      return t('feature.moderation.outputEnabled', { ns: 'appDebug' })
  }, [moderation?.config?.inputs_config?.enabled, moderation?.config?.outputs_config?.enabled, t])

  return (
    <FeatureCard
      icon={(
        <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-text-success p-1 shadow-xs">
          <ContentModeration className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )}
      title={t('feature.moderation.title', { ns: 'appDebug' })}
      value={!!moderation?.enabled}
      onChange={state => handleChange(FeatureEnum.moderation, state)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      disabled={disabled}
    >
      <>
        {!moderation?.enabled && (
          <div className="system-xs-regular line-clamp-2 min-h-8 text-text-tertiary">{t('feature.moderation.description', { ns: 'appDebug' })}</div>
        )}
        {!!moderation?.enabled && (
          <>
            {!isHovering && (
              <div className="flex items-center gap-4 pt-0.5">
                <div className="">
                  <div className="system-2xs-medium-uppercase mb-0.5 text-text-tertiary">{t('feature.moderation.modal.provider.title', { ns: 'appDebug' })}</div>
                  <div className="system-xs-regular text-text-secondary">{providerContent}</div>
                </div>
                <div className="h-[27px] w-px rotate-12 bg-divider-subtle"></div>
                <div className="">
                  <div className="system-2xs-medium-uppercase mb-0.5 text-text-tertiary">{t('feature.moderation.contentEnableLabel', { ns: 'appDebug' })}</div>
                  <div className="system-xs-regular text-text-secondary">{enableContent}</div>
                </div>
              </div>
            )}
            {isHovering && (
              <Button className="w-full" onClick={handleOpenModerationSettingModal} disabled={disabled}>
                <RiEqualizer2Line className="mr-1 h-4 w-4" />
                {t('operation.settings', { ns: 'common' })}
              </Button>
            )}
          </>
        )}
      </>
    </FeatureCard>
  )
}

export default Moderation
