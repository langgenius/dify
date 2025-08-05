import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEqualizer2Line,
  RiMailSendFill,
  RiRobot2Fill,
} from '@remixicon/react'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Switch from '@/app/components/base/switch'
import Indicator from '@/app/components/header/indicator'
import type { DeliveryMethod } from '../../types'
import { DeliveryMethodType } from '../../types'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  method: DeliveryMethod
  onChange: (method: DeliveryMethod) => void
  onDelete: (type: DeliveryMethodType) => void
}

const DeliveryMethodItem: React.FC<Props> = ({ method, onChange, onDelete }) => {
  const { t } = useTranslation()
  const [isHovering, setIsHovering] = React.useState(false)

  const handleEnableStatusChange = (enabled: boolean) => {
    onChange({
      ...method,
      enabled,
    })
  }

  return (
    <div
      className={cn('group flex h-8 items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg pl-1.5 pr-2 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm', isHovering && 'border-state-destructive-border bg-state-destructive-hover hover:bg-state-destructive-hover')}
    >
      <div className='flex items-center gap-1.5'>
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
        <div className='system-xs-medium capitalize text-text-secondary'>{method.type}</div>
      </div>
      <div className='flex items-center gap-1'>
        <div className='hidden items-end gap-1 group-hover:flex'>
          {method.type === DeliveryMethodType.Email && method.configure && (
            <ActionButton>
              <RiEqualizer2Line className='h-4 w-4' />
            </ActionButton>
          )}
          <div
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <ActionButton
              state={isHovering ? ActionButtonState.Destructive : ActionButtonState.Default}
              onClick={() => onDelete(method.type)}
            >
              <RiDeleteBinLine className='h-4 w-4' />
            </ActionButton>
          </div>
        </div>
        {(method.configure || method.type === DeliveryMethodType.WebApp) && (
          <Switch
            defaultValue={method.enabled}
            onChange={handleEnableStatusChange}
          />
        )}
        {method.type === DeliveryMethodType.Email && !method.configure && (
          <Button
            className='-mr-1'
            size='small'
            onClick={() => onChange({ ...method, enabled: !method.enabled })}
          >
            {t(`${i18nPrefix}.deliveryMethod.notConfigured`)}
            <Indicator color='orange' className='ml-1' />
          </Button>
        )}
      </div>
    </div>
  )
}

export default DeliveryMethodItem
