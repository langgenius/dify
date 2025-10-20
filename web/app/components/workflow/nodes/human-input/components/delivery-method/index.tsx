import React from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
import Tooltip from '@/app/components/base/tooltip'
import MethodSelector from './method-selector'
import MethodItem from './method-item'
import type { DeliveryMethod, DeliveryMethodType } from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  value: DeliveryMethod[]
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  onChange: (value: DeliveryMethod[]) => void
}

const DeliveryMethodForm: React.FC<Props> = ({
  value,
  nodesOutputVars,
  availableNodes,
  onChange,
}) => {
  const { t } = useTranslation()

  const handleMethodChange = (target: DeliveryMethod) => {
    const newMethods = produce(value, (draft) => {
      const index = draft.findIndex(method => method.type === target.type)
      if (index !== -1)
        draft[index] = target
    })
    onChange(newMethods)
  }

  const handleMethodAdd = (newMethod: DeliveryMethod) => {
    const newMethods = [...value, newMethod]
    onChange(newMethods)
  }

  const handleMethodDelete = (type: DeliveryMethodType) => {
    const newMethods = value.filter(method => method.type !== type)
    onChange(newMethods)
  }

  return (
    <div className='px-4 py-2'>
      <div className='mb-1 flex items-center justify-between'>
        <div className='flex items-center gap-0.5'>
          <div className='system-sm-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.deliveryMethod.title`)}</div>
          <Tooltip
            popupContent={t(`${i18nPrefix}.deliveryMethod.tooltip`)}
          />
        </div>
        <div className='flex items-center px-1'>
          <MethodSelector
            data={value}
            onAdd={handleMethodAdd}
          />
        </div>
      </div>
      {!value.length && (
        <div className='system-xs-regular flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.emptyTip`)}</div>
      )}
      {value.length > 0 && (
        <div className='space-y-1'>
          {value.map((method, index) => (
            <MethodItem
              method={method}
              key={index}
              onChange={handleMethodChange}
              onDelete={handleMethodDelete}
              nodesOutputVars={nodesOutputVars}
              availableNodes={availableNodes}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default DeliveryMethodForm
