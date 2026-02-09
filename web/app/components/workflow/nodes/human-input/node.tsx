import type { FC } from 'react'
import type { HumanInputNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import {
  RiMailSendFill,
  RiRobot2Fill,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { NodeSourceHandle } from '../_base/components/node-handle'
import { DeliveryMethodType } from './types'

const i18nPrefix = 'nodes.humanInput'

const Node: FC<NodeProps<HumanInputNodeType>> = (props) => {
  const { t } = useTranslation()

  const { data } = props
  const deliveryMethods = data.delivery_methods
  const userActions = data.user_actions

  return (
    <>
      {deliveryMethods.length > 0 && (
        <div className="space-y-0.5 py-1">
          <div className="system-2xs-medium-uppercase px-2.5 py-0.5 text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.title`, { ns: 'workflow' })}</div>
          <div className="space-y-0.5 px-2.5">
            {deliveryMethods.map(method => (
              <div key={method.type} className="flex items-center gap-1 rounded-[6px] bg-workflow-block-parma-bg p-1">
                {method.type === DeliveryMethodType.WebApp && (
                  <div className="rounded-[4px] border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5">
                    <RiRobot2Fill className="h-3.5 w-3.5 text-text-primary-on-surface" />
                  </div>
                )}
                {method.type === DeliveryMethodType.Email && (
                  <div className="rounded-[4px] border border-divider-regular bg-components-icon-bg-blue-solid p-0.5">
                    <RiMailSendFill className="h-3.5 w-3.5 text-text-primary-on-surface" />
                  </div>
                )}
                <span className="system-xs-regular capitalize text-text-secondary">{method.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-0.5 py-1">
        {userActions.length > 0 && (
          <>
            {userActions.map(userAction => (
              <div key={userAction.id} className="relative flex flex-row-reverse items-center px-4 py-1">
                <span className="system-xs-semibold-uppercase truncate text-text-secondary">{userAction.id}</span>
                <NodeSourceHandle
                  {...props}
                  handleId={userAction.id}
                  handleClassName="!top-1/2 !-right-[9px] !-translate-y-1/2"
                />
              </div>
            ))}
          </>
        )}
        <div className="relative flex flex-row-reverse items-center px-4 py-1">
          <div className="system-xs-semibold-uppercase truncate text-text-secondary">Timeout</div>
          <NodeSourceHandle
            {...props}
            handleId="__timeout"
            handleClassName="!top-1/2 !-right-[9px] !-translate-y-1/2"
          />
        </div>
      </div>
    </>
  )
}

export default React.memo(Node)
