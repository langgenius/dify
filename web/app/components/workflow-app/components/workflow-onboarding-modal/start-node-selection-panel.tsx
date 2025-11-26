'use client'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import StartNodeOption from './start-node-option'
import NodeSelector from '@/app/components/workflow/block-selector'
import { Home } from '@/app/components/base/icons/src/vender/workflow'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import type { PluginDefaultValue } from '@/app/components/workflow/block-selector/types'
import { TabsEnum } from '@/app/components/workflow/block-selector/types'

type StartNodeSelectionPanelProps = {
  onSelectUserInput: () => void
  onSelectTrigger: (nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => void
}

const StartNodeSelectionPanel: FC<StartNodeSelectionPanelProps> = ({
  onSelectUserInput,
  onSelectTrigger,
}) => {
  const { t } = useTranslation()
  const [showTriggerSelector, setShowTriggerSelector] = useState(false)

  const handleTriggerClick = useCallback(() => {
    setShowTriggerSelector(true)
  }, [])

  const handleTriggerSelect = useCallback((nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => {
    setShowTriggerSelector(false)
    onSelectTrigger(nodeType, toolConfig)
  }, [onSelectTrigger])

  return (
    <div className="grid grid-cols-2 gap-4">
      <StartNodeOption
        icon={
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[0.5px] border-transparent bg-util-colors-blue-brand-blue-brand-500 p-2">
            <Home className="h-5 w-5 text-white" />
          </div>
        }
        title={t('workflow.onboarding.userInputFull')}
        description={t('workflow.onboarding.userInputDescription')}
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
            icon={
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[0.5px] border-transparent bg-util-colors-blue-brand-blue-brand-500 p-2">
                <TriggerAll className="h-5 w-5 text-white" />
              </div>
            }
            title={t('workflow.onboarding.trigger')}
            description={t('workflow.onboarding.triggerDescription')}
            onClick={handleTriggerClick}
          />
        )}
        popupClassName="z-[1200]"
      />
    </div>
  )
}

export default StartNodeSelectionPanel
