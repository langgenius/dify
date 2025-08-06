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
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
import type { Var } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.humanInput'

const Panel: FC<NodePanelProps<HumanInputNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    inputs,
    handleDeliveryMethodChange,
    handleUserActionAdd,
    handleUserActionChange,
    handleUserActionDelete,
    handleTimeoutChange,
  } = useConfig(id, data)

  const { availableVars, availableNodesWithParent } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })

  return (
    <div className='py-2'>
      {/* delivery methods */}
      <DeliveryMethod
        value={inputs.delivery_methods || []}
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        onChange={handleDeliveryMethodChange}
      />
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
                  id: 'Action',
                  title: 'Button Text',
                  button_style: UserActionButtonType.Default,
                })
              }}
            >
              <RiAddLine className='h-4 w-4' />
            </ActionButton>
          </div>
        </div>
        {!inputs.user_actions.length && (
          <div className='system-xs-regular flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>{t(`${i18nPrefix}.userActions.emptyTip`)}</div>
        )}
        {inputs.user_actions.length > 0 && (
          <div className='space-y-2'>
            {inputs.user_actions.map(action => (
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
