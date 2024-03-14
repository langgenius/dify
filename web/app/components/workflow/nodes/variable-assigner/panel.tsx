import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import VarList from './components/var-list'
import type { VariableAssignerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Selector from '@/app/components/workflow/nodes/_base/components/selector'
import AddButton from '@/app/components/base/button/add-button'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.variableAssigner'
const Panel: FC<NodePanelProps<VariableAssignerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleOutputTypeChange,
    handleVarListChange,
    handleAddVariable,
  } = useConfig(id, data)

  const typeOptions = [
    { label: t(`${i18nPrefix}.type.string`), value: VarType.string },
    { label: t(`${i18nPrefix}.type.number`), value: VarType.number },
    { label: t(`${i18nPrefix}.type.object`), value: VarType.object },
    { label: t(`${i18nPrefix}.type.array`), value: VarType.array },
  ]

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.outputVarType`)}
        >
          <Selector
            readonly={readOnly}
            value={inputs.output_type}
            options={typeOptions}
            onChange={handleOutputTypeChange}
            trigger={
              <div className='flex items-center h-8 justify-between px-2.5 rounded-lg bg-gray-100 capitalize'>
                <div className='text-[13px] font-normal text-gray-900'>{inputs.output_type}</div>
                <ChevronDown className='w-3.5 h-3.5 text-gray-700' />
              </div>
            }
            popupClassName='!top-[36px] !w-[387px]'
            showChecked
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.title`)}
          operations={
            <AddButton onClick={handleAddVariable} />
          }
        >
          <VarList
            readonly={readOnly}
            nodeId={id}
            list={inputs.variables}
            onChange={handleVarListChange}
            onlyLeafNodeVar
            onlyVarType={inputs.output_type}
          />
        </Field>
      </div>

    </div>
  )
}

export default React.memo(Panel)
