import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import VarList from './components/var-list'
import useConfig from './use-config'
import type { AssignerNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { useHandleAddOperationItem } from './hooks'
import ActionButton from '@/app/components/base/action-button'

const i18nPrefix = 'workflow.nodes.assigner'

const Panel: FC<NodePanelProps<AssignerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const handleAddOperationItem = useHandleAddOperationItem()
  const {
    readOnly,
    inputs,
    handleOperationListChanges,
    getAssignedVarType,
    getToAssignedVarType,
    writeModeTypesNum,
    writeModeTypesArr,
    writeModeTypes,
    filterAssignedVar,
    filterToAssignedVar,
  } = useConfig(id, data)
  const handleAddOperation = () => {
    const newList = handleAddOperationItem(inputs.items || [])
    handleOperationListChanges(newList)
  }

  return (
    <div className='flex flex-col items-start self-stretch py-2'>
      <div className='flex w-full flex-col items-start justify-center gap-1 self-stretch px-4 py-2'>
        <div className='flex items-start gap-2 self-stretch'>
          <div className='system-sm-semibold-uppercase flex grow flex-col items-start justify-center text-text-secondary'>{t(`${i18nPrefix}.variables`)}</div>
          <ActionButton onClick={handleAddOperation}>
            <RiAddLine className='h-4 w-4 shrink-0 text-text-tertiary' />
          </ActionButton>
        </div>
        <VarList
          readonly={readOnly}
          nodeId={id}
          list={inputs.items || []}
          onChange={(newList) => {
            handleOperationListChanges(newList)
          }}
          filterVar={filterAssignedVar}
          filterToAssignedVar={filterToAssignedVar}
          getAssignedVarType={getAssignedVarType}
          writeModeTypes={writeModeTypes}
          writeModeTypesArr={writeModeTypesArr}
          writeModeTypesNum={writeModeTypesNum}
          getToAssignedVarType={getToAssignedVarType}
        />
      </div>
    </div>
  )
}

export default React.memo(Panel)
