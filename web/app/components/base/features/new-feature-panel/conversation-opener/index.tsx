import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { PromptVariable } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { RiEditLine } from '@remixicon/react'
import { lazy, Suspense } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import FeatureCard from '@/app/components/base/features/new-feature-panel/feature-card'

const OpeningSettingModal = lazy(
  () => import('@/app/components/base/features/new-feature-panel/conversation-opener/modal'),
)

type Props = Readonly<{
  disabled?: boolean
  onChange?: OnFeaturesChange
  promptVariables?: PromptVariable[]
  workflowVariables?: InputVar[]
  onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
}>

const ConversationOpener = ({
  disabled,
  onChange,
  promptVariables,
  workflowVariables,
  onAutoAddPromptVariable,
}: Props) => {
  const { t } = useTranslation(['appDebug'])
  const actionsRef = React.useRef<DialogActions>(null)
  const opening = useFeatures((s) => s.features.opening)
  const featuresStore = useFeaturesStore()
  function changeEnabled(enabled: boolean) {
    const { features, setFeatures } = featuresStore!.getState()
    setFeatures({ ...features, opening: { ...features.opening, enabled } })
    onChange?.()
  }

  return (
    <Dialog actionsRef={actionsRef} disablePointerDismissal>
      <FeatureCard
        icon={
          <div className="shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-light-blue-light-500 p-1 shadow-xs">
            <span
              aria-hidden
              className="i-custom-vender-features-love-message size-4 text-text-primary-on-surface"
            />
          </div>
        }
        title={t(($) => $['feature.conversationOpener.title'], { ns: 'appDebug' })}
        value={!!opening?.enabled}
        onChange={changeEnabled}
        disabled={disabled}
      >
        <>
          {!opening?.enabled && (
            <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
              {t(($) => $['feature.conversationOpener.description'], { ns: 'appDebug' })}
            </div>
          )}
          {!!opening?.enabled && (
            <div className="flex items-center justify-between gap-2">
              <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">
                {opening.opening_statement ||
                  t(($) => $['openingStatement.placeholderLine1'], { ns: 'appDebug' })}
              </div>
              <DialogTrigger
                render={
                  <Button
                    className="shrink-0 group-hover/feature-card:opacity-100 focus-visible:opacity-100 pointer-fine:opacity-0"
                    disabled={disabled}
                  />
                }
              >
                <RiEditLine className="size-4" />
                {t(($) => $['openingStatement.writeOpener'], { ns: 'appDebug' })}
              </DialogTrigger>
            </div>
          )}
        </>
      </FeatureCard>
      <Suspense fallback={null}>
        <DialogContent className="w-160">
          <OpeningSettingModal
            data={opening ?? {}}
            promptVariables={promptVariables}
            workflowVariables={workflowVariables}
            onAutoAddPromptVariable={onAutoAddPromptVariable}
            onSave={(value) => {
              const { features, setFeatures } = featuresStore!.getState()
              setFeatures({ ...features, opening: value })
              onChange?.()
              actionsRef.current?.close()
            }}
          />
        </DialogContent>
      </Suspense>
    </Dialog>
  )
}

export default ConversationOpener
