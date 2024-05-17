import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import VarList from './components/var-list'
import type { VariableAssignerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

const i18nPrefix = 'workflow.nodes.variableAssigner'
const Panel: FC<NodePanelProps<VariableAssignerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleOnVarOpen,
    filterVar,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.title`)}
          operations={
            !readOnly
              ? <VarReferencePicker
                isAddBtnTrigger
                readonly={false}
                nodeId={id}
                isShowNodeName
                value={[]}
                onChange={handleAddVariable}
                defaultVarKindType={VarKindType.variable}
              />
              : undefined
          }
        >
          <VarList
            readonly={readOnly}
            nodeId={id}
            list={inputs.variables}
            onChange={handleVarListChange}
            onOpen={handleOnVarOpen}
            onlyLeafNodeVar
            filterVar={filterVar}
          />
        </Field>
      </div>
      <Split />
      <div className='px-4 pt-4 pb-2'>
        <OutputVars>
          <>
            <VarItem
              name='output'
              type={inputs.output_type}
              description={t(`${i18nPrefix}.outputVars.output`)}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
