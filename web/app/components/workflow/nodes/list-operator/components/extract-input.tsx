'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { VarType } from '../../../types'
import type { Var } from '../../../types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import cn from '@/utils/classnames'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'

type Props = {
  nodeId: string
  readOnly: boolean
  value: string
  onChange: (value: string) => void
}

const ExtractInput: FC<Props> = ({
  nodeId,
  readOnly,
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  const [isFocus, setIsFocus] = useState(false)
  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.number].includes(varPayload.type)
    },
  })

  return (
    <div className='flex items-start  space-x-1'>
      <Input
        instanceId='http-extract-number'
        className={cn(isFocus ? 'shadow-xs bg-gray-50 border-gray-300' : 'bg-gray-100 border-gray-100', 'w-0 grow rounded-lg px-3 py-[6px] border')}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        nodesOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        onFocusChange={setIsFocus}
        placeholder={!readOnly ? t('workflow.nodes.http.extractListPlaceholder')! : ''}
        placeholderClassName='!leading-[21px]'
      />
    </div >
  )
}
export default React.memo(ExtractInput)
