import type { HumanInputSharedNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import { NodeSourceHandle } from '../../_base/components/node-handle'

const HumanInputNodeBranches = <T extends HumanInputSharedNodeType>(props: NodeProps<T>) => {
  const { t } = useTranslation()
  const { user_actions: userActions } = props.data

  return (
    <div className="space-y-0.5 py-1">
      {userActions.map((userAction) => (
        <div key={userAction.id} className="relative flex flex-row-reverse items-center px-4 py-1">
          <span className="truncate system-xs-semibold-uppercase text-text-secondary">
            {userAction.id}
          </span>
          <NodeSourceHandle
            {...props}
            handleId={userAction.id}
            handleClassName="top-1/2! -right-[9px]! -translate-y-1/2!"
          />
        </div>
      ))}
      <div className="relative flex flex-row-reverse items-center px-4 py-1">
        <div className="truncate system-xs-semibold-uppercase text-text-secondary">
          {t(($) => $['nodes.humanInput.timeout.title'], { ns: 'workflow' })}
        </div>
        <NodeSourceHandle
          {...props}
          handleId="__timeout"
          handleClassName="top-1/2! -right-[9px]! -translate-y-1/2!"
        />
      </div>
    </div>
  )
}

export default HumanInputNodeBranches
