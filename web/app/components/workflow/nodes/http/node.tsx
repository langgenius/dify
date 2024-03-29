import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { HttpNodeType } from './types'
import type { NodeProps, Var } from '@/app/components/workflow/types'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
import Input from '@/app/components/workflow/nodes/_base/components/input-support-select-var'

const Node: FC<NodeProps<HttpNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const { method, url } = data
  const availableVarList = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      return [VarType.string, VarType.number].includes(varPayload.type)
    },
  })
  return (
    <div className='mb-1 px-3 py-1'>
      <div className='flex items-center p-1 rounded-md bg-gray-100'>
        <div className='shrink-0 px-1 h-7 leading-7 rounded bg-gray-25 text-xs font-semibold text-gray-700 uppercase'>{method}</div>
        <Input
          className={cn('bg-gray-100 border-gray-100', 'w-0 grow rounded-lg px-3 py-[6px] border')}
          value={url}
          onChange={() => { }}
          readOnly
          nodesOutputVars={availableVarList}
          onFocusChange={() => { }}
          placeholder={t('workflow.nodes.http.apiPlaceholder')!}
          placeholderClassName='!leading-[21px]'
        />
      </div>
    </div>
  )
}

export default React.memo(Node)
