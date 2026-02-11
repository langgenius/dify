import type { ExecutedAction as ExecutedActionType } from './type'
import { memo } from 'react'
import { Trans } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'

type ExecutedActionProps = {
  executedAction: ExecutedActionType
}

const ExecutedAction = ({
  executedAction,
}: ExecutedActionProps) => {
  return (
    <div className="flex flex-col gap-y-1 py-1">
      <Divider className="mb-2 mt-1 w-[30px]" />
      <div className="system-xs-regular flex items-center gap-x-1 text-text-tertiary">
        <TriggerAll className="size-3.5 shrink-0" />
        <Trans
          i18nKey="nodes.humanInput.userActions.triggered"
          ns="workflow"
          components={{ strong: <span className="system-xs-medium text-text-secondary"></span> }}
          values={{ actionName: executedAction.id }}
        />
      </div>
    </div>
  )
}

export default memo(ExecutedAction)
