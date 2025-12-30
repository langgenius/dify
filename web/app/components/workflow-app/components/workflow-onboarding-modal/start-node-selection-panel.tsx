'use client'
import type { FC } from 'react'
import type { PluginDefaultValue } from '@/app/components/workflow/block-selector/types'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Home, TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import NodeSelector from '@/app/components/workflow/block-selector'
import { TabsEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import StartNodeOption from './start-node-option'

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
        icon={(
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[0.5px] border-transparent bg-util-colors-blue-brand-blue-brand-500 p-2">
            <Home className="h-5 w-5 text-white" />
          </div>
        )}
        title={t('onboarding.userInputFull', { ns: 'workflow' })}
        description={t('onboarding.userInputDescription', { ns: 'workflow' })}
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
                <TriggerAll className="h-5 w-5 text-white" />
              </div>
            )}
            title={t('onboarding.trigger', { ns: 'workflow' })}
            description={t('onboarding.triggerDescription', { ns: 'workflow' })}
            onClick={handleTriggerClick}
          />
        )}
        popupClassName="z-[1200]"
      />
    </div>
  )
}

export default StartNodeSelectionPanel
