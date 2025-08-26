'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import StartNodeOption from './start-node-option'
import { Home } from '@/app/components/base/icons/src/vender/workflow'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'

type StartNodeSelectionPanelProps = {
  onSelectUserInput: () => void
  onSelectTrigger: () => void
}

const StartNodeSelectionPanel: FC<StartNodeSelectionPanelProps> = ({
  onSelectUserInput,
  onSelectTrigger,
}) => {
  const { t } = useTranslation()

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

      <StartNodeOption
        icon={
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border-[0.5px] border-transparent bg-util-colors-blue-brand-blue-brand-500 p-2">
            <TriggerAll className="h-5 w-5 text-white" />
          </div>
        }
        title={t('workflow.onboarding.trigger')}
        description={t('workflow.onboarding.triggerDescription')}
        onClick={onSelectTrigger}
      />
    </div>
  )
}

export default StartNodeSelectionPanel
