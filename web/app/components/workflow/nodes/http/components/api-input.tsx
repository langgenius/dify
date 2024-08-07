'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import { Method } from '../types'
import Selector from '../../_base/components/selector'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import { VarType } from '../../../types'
import type { Var } from '../../../types'
import cn from '@/utils/classnames'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'

const MethodOptions = [
  { label: 'GET', value: Method.get },
  { label: 'POST', value: Method.post },
  { label: 'HEAD', value: Method.head },
  { label: 'PATCH', value: Method.patch },
  { label: 'PUT', value: Method.put },
  { label: 'DELETE', value: Method.delete },
]
type Props = {
  nodeId: string
  readonly: boolean
  method: Method
  onMethodChange: (method: Method) => void
  url: string
  onUrlChange: (url: string) => void
}

const ApiInput: FC<Props> = ({
  nodeId,
  readonly,
  method,
  onMethodChange,
  url,
  onUrlChange,
}) => {
  const { t } = useTranslation()

  const [isFocus, setIsFocus] = useState(false)
  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number, VarType.secret].includes(varPayload.type)
    },
  })

  return (
    <div className='flex items-start  space-x-1'>
      <Selector
        value={method}
        onChange={onMethodChange}
        options={MethodOptions}
        trigger={
          <div className={cn(readonly && 'cursor-pointer', 'h-8 shrink-0 flex items-center px-2.5 bg-gray-100 border-black/5 rounded-lg')} >
            <div className='w-12 pl-0.5 leading-[18px] text-xs font-medium text-gray-900 uppercase'>{method}</div>
            {!readonly && <RiArrowDownSLine className='ml-1 w-3.5 h-3.5 text-gray-700' />}
          </div>
        }
        popupClassName='top-[34px] w-[108px]'
        showChecked
        readonly={readonly}
      />

      <Input
        instanceId='http-api-url'
        className={cn(isFocus ? 'shadow-xs bg-gray-50 border-gray-300' : 'bg-gray-100 border-gray-100', 'w-0 grow rounded-lg px-3 py-[6px] border')}
        value={url}
        onChange={onUrlChange}
        readOnly={readonly}
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        onFocusChange={setIsFocus}
        placeholder={!readonly ? t('workflow.nodes.http.apiPlaceholder')! : ''}
        placeholderClassName='!leading-[21px]'
      />
    </div >
  )
}
export default React.memo(ApiInput)
