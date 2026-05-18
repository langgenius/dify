import type {
  OnFeaturesChange,
  SuggestedQuestionsAfterAnswer,
} from '@/app/components/base/features/types'
import { Button } from '@langgenius/dify-ui/button'
import { RiEqualizer2Line } from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import FollowUpSettingModal from '@/app/components/base/features/new-feature-panel/follow-up-setting-modal'
import { FeatureEnum } from '@/app/components/base/features/types'
import { VirtualAssistant } from '@/app/components/base/icons/src/vender/features'

type Props = {
  disabled?: boolean
  onChange?: OnFeaturesChange
}

const FollowUp = ({
  disabled,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const suggested = useFeatures(s => s.features.suggested)
  const featuresStore = useFeaturesStore()
  const [isHovering, setIsHovering] = useState(false)
  const [isShowSettingModal, setIsShowSettingModal] = useState(false)

  const handleChange = useCallback((type: FeatureEnum, enabled: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft[type] = {
        ...draft[type],
        enabled,
      }
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handleSave = useCallback((newSuggested: SuggestedQuestionsAfterAnswer) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft.suggested = {
        ...newSuggested,
        enabled: true,
      }
    })
    setFeatures(newFeatures)
    setIsShowSettingModal(false)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handleOpenSettingModal = useCallback(() => {
    if (disabled)
      return
    setIsShowSettingModal(true)
  }, [disabled])

  return (
    <>
      <FeatureCard
        icon={(
          <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-light-blue-light-500 p-1 shadow-xs">
            <VirtualAssistant className="h-4 w-4 text-text-primary-on-surface" />
          </div>
        )}
        title={t('feature.suggestedQuestionsAfterAnswer.title', { ns: 'appDebug' })}
        value={!!suggested?.enabled}
        onChange={state => handleChange(FeatureEnum.suggested, state)}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        disabled={disabled}
      >
        <>
          {!suggested?.enabled && (
            <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
              {t('feature.suggestedQuestionsAfterAnswer.description', { ns: 'appDebug' })}
            </div>
          )}
          {!!suggested?.enabled && (
            <>
              {!isHovering && (
                <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
                  {suggested.model?.name || t('feature.suggestedQuestionsAfterAnswer.modal.defaultModel', { ns: 'appDebug' })}
                </div>
              )}
              {isHovering && (
                <Button className="w-full" onClick={handleOpenSettingModal} disabled={disabled}>
                  <RiEqualizer2Line className="mr-1 h-4 w-4" />
                  {t('operation.settings', { ns: 'common' })}
                </Button>
              )}
            </>
          )}
        </>
      </FeatureCard>
      {isShowSettingModal && (
        <FollowUpSettingModal
          data={suggested || { enabled: true }}
          onSave={handleSave}
          onCancel={() => setIsShowSettingModal(false)}
        />
      )}
    </>
  )
}

export default FollowUp
