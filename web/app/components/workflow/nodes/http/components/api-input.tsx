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
          <div className={cn(readonly && 'cursor-pointer', 'flex h-8 shrink-0 items-center rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-2.5')} >
            <div className='w-12 pl-0.5 text-xs font-medium uppercase leading-[18px] text-text-primary'>{method}</div>
            {!readonly && <RiArrowDownSLine className='ml-1 h-3.5 w-3.5 text-text-secondary' />}
          </div>
        }
        popupClassName='top-[34px] w-[108px]'
        showChecked
        readonly={readonly}
      />

      <Input
        instanceId='http-api-url'
        className={cn(isFocus ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs' : 'border-components-input-border-hover bg-components-input-bg-normal', 'w-0 grow rounded-lg border px-3 py-[6px]')}
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
