import type { ExecutedAction as ExecutedActionType } from './type'
import { memo } from 'react'
import { Trans } from 'react-i18next'
import Divider from '@/app/components/base/divider'

type ExecutedActionProps = {
  executedAction: ExecutedActionType
}

const ExecutedAction = ({
  executedAction,
}: ExecutedActionProps) => {
  return (
    <div className="flex flex-col gap-y-1 py-1" data-testid="executed-action">
      <Divider className="mt-1 mb-2 w-[30px]" />
      <div className="flex items-center gap-x-1 system-xs-regular text-text-tertiary">
        <div className="i-custom-vender-workflow-trigger-all size-3.5 shrink-0" />
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
