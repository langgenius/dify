'use client'
import type { FC } from 'react'
import type { BlockDefaultValue } from '@/app/components/workflow/block-selector/types'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NodeSelector from '@/app/components/workflow/block-selector'
import { TabsEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import StartNodeOption from './start-node-option'

type StartNodeSelectionPanelProps = {
  onSelectUserInput: () => void
  onSelectTrigger: (nodeType: BlockEnum, toolConfig?: BlockDefaultValue) => void
}

const StartNodeSelectionPanel: FC<StartNodeSelectionPanelProps> = ({
  onSelectUserInput,
  onSelectTrigger,
}) => {
  const { t } = useTranslation()
  const [showTriggerSelector, setShowTriggerSelector] = useState(false)

  const handleTriggerSelect = useCallback((nodeType: BlockEnum, toolConfig?: BlockDefaultValue) => {
    setShowTriggerSelector(false)
    onSelectTrigger(nodeType, toolConfig)
  }, [onSelectTrigger])

  return (
    <div className="grid grid-cols-2 gap-4">
      <StartNodeOption
        icon={(
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[0.5px] border-transparent bg-util-colors-blue-brand-blue-brand-500 p-2">
            <span className="i-custom-vender-workflow-home size-5 text-white" />
          </div>
        )}
        title={t($ => $['onboarding.userInputFull'], { ns: 'workflow' })}
        description={t($ => $['onboarding.userInputDescription'], { ns: 'workflow' })}
        onClick={onSelectUserInput}
      />

      <NodeSelector
        open={showTriggerSelector}
        onOpenChange={setShowTriggerSelector}
        onSelect={handleTriggerSelect}
        placement="right"
        offset={-200}
        noBlocks={true}
        showStartTab={true}
        defaultActiveTab={TabsEnum.Start}
        forceShowStartContent={true}
        availableBlocksTypes={[
          BlockEnum.TriggerSchedule,
          BlockEnum.TriggerWebhook,
          BlockEnum.TriggerPlugin,
        ]}
        trigger={() => (
          <StartNodeOption
            icon={(
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[0.5px] border-transparent bg-util-colors-blue-brand-blue-brand-500 p-2">
                <span className="i-custom-vender-workflow-trigger-all size-5 text-white" />
              </div>
            )}
            title={t($ => $['onboarding.trigger'], { ns: 'workflow' })}
            description={t($ => $['onboarding.triggerDescription'], { ns: 'workflow' })}
            onClick={() => setShowTriggerSelector(true)}
          />
        )}
      />
    </div>
  )
}

export default StartNodeSelectionPanel
