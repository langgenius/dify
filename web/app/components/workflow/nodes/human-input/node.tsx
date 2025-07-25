import type { FC } from 'react'
import React from 'react'
import {
  RiMailSendFill,
  RiRobot2Fill,
} from '@remixicon/react'
import { NodeSourceHandle } from '../_base/components/node-handle'
import type { HumanInputNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { DeliveryMethodType } from './types'

const Node: FC<NodeProps<HumanInputNodeType>> = (props) => {
  const { data } = props
  const deliveryMethods = data.deliveryMethod
  const userActions = data.userActions

  return (
    <>
      {deliveryMethods.length > 0 && (
        <div className='space-y-0.5 py-1'>
          <div className='system-2xs-medium-uppercase px-2.5 py-0.5 text-text-tertiary'>delivery method</div>
          <div className='space-y-0.5 px-2.5'>
            {deliveryMethods.map(method => (
              <div key={method.type} className='flex items-center gap-1 rounded-[6px] bg-workflow-block-parma-bg p-1'>
                {method.type === DeliveryMethodType.WebApp && (
                  <div className='rounded-[4px] border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5'>
                    <RiRobot2Fill className='h-3.5 w-3.5 text-text-primary-on-surface' />
                  </div>
                )}
                {method.type === DeliveryMethodType.Email && (
                  <div className='rounded-[4px] border border-divider-regular bg-components-icon-bg-blue-solid p-0.5'>
                    <RiMailSendFill className='h-3.5 w-3.5 text-text-primary-on-surface' />
                  </div>
                )}
                <span className='system-xs-regular capitalize text-text-secondary'>{method.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {userActions.length > 0 && (
        <div className='space-y-0.5 py-1'>
          {userActions.map(userAction => (
            <div key={userAction.name} className='relative flex flex-row-reverse items-center px-4 py-1'>
              <span className='system-xs-semibold-uppercase truncate text-text-secondary'>{userAction.name}</span>
              <NodeSourceHandle
                {...props}
                handleId={userAction.name}
                handleClassName='!top-1/2 !-right-[9px] !-translate-y-1/2'
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default React.memo(Node)
