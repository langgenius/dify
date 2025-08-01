import type { FC } from 'react'
import React from 'react'
import {
  RiAddLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import type { HumanInputNodeType } from './types'
import { UserActionButtonType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import Divider from '@/app/components/base/divider'
import DeliveryMethod from './components/delivery-method'
import UserActionItem from './components/user-action'
import TimeoutInput from './components/timeout'
import { v4 as uuid4 } from 'uuid'

const i18nPrefix = 'workflow.nodes.humanInput'

const Panel: FC<NodePanelProps<HumanInputNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    inputs,
    handleUserActionAdd,
    handleUserActionChange,
    handleUserActionDelete,
    handleTimeoutChange,
  } = useConfig(id, data)
  return (
    <div className='py-2'>
      {/* delivery methods */}
      <DeliveryMethod />
      <div className='px-4 py-2'>
        <Divider className='!my-0 !h-px !bg-divider-subtle' />
      </div>
      {/* user actions */}
      <div className='px-4 py-2'>
        <div className='mb-1 flex items-center justify-between'>
          <div className='flex items-center gap-0.5'>
            <div className='system-sm-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.userActions.title`)}</div>
            <Tooltip
              popupContent={t(`${i18nPrefix}.userActions.tooltip`)}
            />
          </div>
          <div className='flex items-center px-1'>
            <ActionButton
              onClick={() => {
                handleUserActionAdd({
                  id: uuid4(),
                  name: 'Action',
                  text: 'Button Text',
                  type: UserActionButtonType.Default,
                })
              }}
            >
              <RiAddLine className='h-4 w-4' />
            </ActionButton>
          </div>
        </div>
        {!inputs.userActions.length && (
          <div className='system-xs-regular flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>{t(`${i18nPrefix}.userActions.emptyTip`)}</div>
        )}
        {inputs.userActions.length > 0 && (
          <div className='space-y-2'>
            {inputs.userActions.map(action => (
              <UserActionItem
                key={action.id}
                data={action}
                onChange={handleUserActionChange}
                onDelete={handleUserActionDelete}
              />
            ))}
          </div>
        )}
      </div>
      <div className='px-4 py-2'>
        <Divider className='!my-0 !h-px !bg-divider-subtle' />
      </div>
      {/* timeout */}
      <div className='flex items-center justify-between px-4 py-2'>
        <div className='system-sm-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.timeout.title`)}</div>
        <TimeoutInput
          timeout={inputs.timeout}
          onChange={handleTimeoutChange}
        />
      </div>
    </div>
  )
}

export default React.memo(Panel)
