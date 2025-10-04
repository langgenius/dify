import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { RiEditLine } from '@remixicon/react'
import { LoveMessage } from '@/app/components/base/icons/src/vender/features'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import Button from '@/app/components/base/button'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { FeatureEnum } from '@/app/components/base/features/types'
import { useModalContext } from '@/context/modal-context'
import type { PromptVariable } from '@/models/debug'
import type { InputVar } from '@/app/components/workflow/types'

type Props = {
  disabled?: boolean
  onChange?: OnFeaturesChange
  promptVariables?: PromptVariable[]
  workflowVariables?: InputVar[]
  onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
}

const ConversationOpener = ({
  disabled,
  onChange,
  promptVariables,
  workflowVariables,
  onAutoAddPromptVariable,
}: Props) => {
  const { t } = useTranslation()
  const { setShowOpeningModal } = useModalContext()
  const opening = useFeatures(s => s.features.opening)
  const featuresStore = useFeaturesStore()
  const [isHovering, setIsHovering] = useState(false)
  const handleOpenOpeningModal = useCallback(() => {
    if (disabled)
      return
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    setShowOpeningModal({
      payload: {
        ...opening,
        promptVariables,
        workflowVariables,
        onAutoAddPromptVariable,
      },
      onSaveCallback: (newOpening) => {
        const newFeatures = produce(features, (draft) => {
          draft.opening = {
            ...newOpening,
            enabled: !!(newOpening.opening_statement || (newOpening.suggested_questions && newOpening.suggested_questions.length > 0)),
          }
        })
        setFeatures(newFeatures)
        if (onChange)
          onChange()
      },
      onCancelCallback: () => {
        const newFeatures = produce(features, (draft) => {
          if (draft.opening && !draft.opening.opening_statement && !(draft.opening.suggested_questions && draft.opening.suggested_questions.length > 0))
            draft.opening.enabled = false
        })
        setFeatures(newFeatures)
        if (onChange)
          onChange()
      },
    })
  }, [disabled, featuresStore, onAutoAddPromptVariable, onChange, opening, promptVariables, setShowOpeningModal])

  const handleChange = useCallback((type: FeatureEnum, enabled: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    if (enabled && !features.opening?.opening_statement && !(features.opening?.suggested_questions && features.opening.suggested_questions.length > 0)) {
      handleOpenOpeningModal()
      return
    }

    const newFeatures = produce(features, (draft) => {
      draft[type] = {
        ...draft[type],
        enabled,
      }
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange()
  }, [featuresStore, onChange, handleOpenOpeningModal])

  return (
    <FeatureCard
      icon={
        <div className='shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-light-blue-light-500 p-1 shadow-xs'>
          <LoveMessage className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      }
      title={t('appDebug.feature.conversationOpener.title')}
      value={!!opening?.enabled}
      onChange={state => handleChange(FeatureEnum.opening, state)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      disabled={disabled}
    >
      <>
        {!opening?.enabled && (
          <div className='system-xs-regular line-clamp-2 min-h-8 text-text-tertiary'>{t('appDebug.feature.conversationOpener.description')}</div>
        )}
        {!!opening?.enabled && (
          <>
            {!isHovering && (
              <div className='system-xs-regular line-clamp-2 min-h-8 text-text-tertiary'>
                {opening.opening_statement || t('appDebug.openingStatement.placeholder')}
              </div>
            )}
            {isHovering && (
              <Button className='w-full' onClick={handleOpenOpeningModal} disabled={disabled}>
                <RiEditLine className='mr-1 h-4 w-4' />
                {t('appDebug.openingStatement.writeOpener')}
              </Button>
            )}
          </>
        )}
      </>
    </FeatureCard>
  )
}

export default ConversationOpener
