import type { OnFeaturesChange } from '@/app/components/base/features/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { PromptVariable } from '@/models/debug'
import { RiEditLine } from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'
import { FeatureEnum } from '@/app/components/base/features/types'
import { LoveMessage } from '@/app/components/base/icons/src/vender/features'
import { useModalContext } from '@/context/modal-context'

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
          draft.opening = newOpening
        })
        setFeatures(newFeatures)
        if (onChange)
          onChange()
      },
      onCancelCallback: () => {
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

    const newFeatures = produce(features, (draft) => {
      draft[type] = {
        ...draft[type],
        enabled,
      }
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange()
  }, [featuresStore, onChange])

  return (
    <FeatureCard
      icon={(
        <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-light-blue-light-500 p-1 shadow-xs">
          <LoveMessage className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )}
      title={t('feature.conversationOpener.title', { ns: 'appDebug' })}
      value={!!opening?.enabled}
      onChange={state => handleChange(FeatureEnum.opening, state)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      disabled={disabled}
    >
      <>
        {!opening?.enabled && (
          <div className="system-xs-regular line-clamp-2 min-h-8 text-text-tertiary">{t('feature.conversationOpener.description', { ns: 'appDebug' })}</div>
        )}
        {!!opening?.enabled && (
          <>
            {!isHovering && (
              <div className="system-xs-regular line-clamp-2 min-h-8 text-text-tertiary">
                {opening.opening_statement || t('openingStatement.placeholder', { ns: 'appDebug' })}
              </div>
            )}
            {isHovering && (
              <Button className="w-full" onClick={handleOpenOpeningModal} disabled={disabled}>
                <RiEditLine className="mr-1 h-4 w-4" />
                {t('openingStatement.writeOpener', { ns: 'appDebug' })}
              </Button>
            )}
          </>
        )}
      </>
    </FeatureCard>
  )
}

export default ConversationOpener
