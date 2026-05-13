import { RiMindMap } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

const FailBranchCard = () => {
  const { t } = useTranslation()

  return (
    <div className="px-4 pt-2">
      <div className="rounded-[10px] bg-workflow-process-bg p-4">
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg">
          <RiMindMap className="h-5 w-5 text-text-tertiary" />
        </div>
        <div className="mb-1 system-sm-medium text-text-secondary">
          {t('nodes.common.errorHandle.failBranch.customize', { ns: 'workflow' })}
        </div>
        <div className="system-xs-regular text-text-tertiary">
          {t('nodes.common.errorHandle.failBranch.customizeTip', { ns: 'workflow' })}
        </div>
      </div>
    </div>
  )
}

export default FailBranchCard
