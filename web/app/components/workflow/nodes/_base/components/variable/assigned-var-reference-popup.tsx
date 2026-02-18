'use client'
import type { FC } from 'react'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ListEmpty from '@/app/components/base/list-empty'
import VarReferenceVars from './var-reference-vars'

type Props = {
  vars: NodeOutPutVar[]
  onChange: (value: ValueSelector, varDetail: Var) => void
  itemWidth?: number
}
const AssignedVarReferencePopup: FC<Props> = ({
  vars,
  onChange,
  itemWidth,
}) => {
  const { t } = useTranslation()
  // max-h-[300px] overflow-y-auto todo: use portal to handle long list
  return (
    <div className="bg-components-panel-bg-bur w-[352px] rounded-lg border-[0.5px] border-components-panel-border p-1 shadow-lg">
      {(!vars || vars.length === 0)
        ? (
            <ListEmpty
              title={t('nodes.assigner.noAssignedVars', { ns: 'workflow' }) || ''}
              description={t('nodes.assigner.assignedVarsDescription', { ns: 'workflow' })}
            />
          )
        : (
            <VarReferenceVars
              searchBoxClassName="mt-1"
              vars={vars}
              onChange={onChange}
              itemWidth={itemWidth}
              isSupportFileVar
            />
          )}
    </div>
  )
}
export default React.memo(AssignedVarReferencePopup)
