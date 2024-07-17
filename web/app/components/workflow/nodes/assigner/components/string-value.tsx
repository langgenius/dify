'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { Var } from '../../../types'
import { VarType } from '../../../types'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'

type Props = {
  nodeId: string
  value: any
  onChange: (value: any) => void
  readOnly: boolean
}

const StringValue: FC<Props> = ({
  nodeId,
  value,
  onChange,
  readOnly,
}) => {
  const { t } = useTranslation()

  const [isFocus, setIsFocus] = useState(false)

  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number].includes(varPayload.type)
    },
  })

  return (
    <Input
      className={cn(isFocus ? 'bg-components-input-bg-active border-components-input-border-active' : 'bg-components-input-bg-normal border-components-input-bg-normal', 'px-3 py-1 border rounded-md')}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      nodesOutputVars={availableVars}
      availableNodes={availableNodesWithParent}
      onFocusChange={setIsFocus}
      placeholder={t('workflow.nodes.http.insertVarPlaceholder')!}
      placeholderClassName='!leading-[21px]'
      promptMinHeightClassName='h-full'
    />
  )
}
export default React.memo(StringValue)
