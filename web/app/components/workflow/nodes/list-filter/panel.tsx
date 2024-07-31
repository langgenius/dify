import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import useConfig from './use-config'
import type { ListFilterNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { type NodePanelProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.listFilter'

const Panel: FC<NodePanelProps<ListFilterNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleVarChanges,
    filterVar,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.inputVar`)}
        >
          <VarReferencePicker
            readonly={readOnly}
            nodeId={id}
            isShowNodeName
            value={inputs.variable || []}
            onChange={handleVarChanges}
            filterVar={filterVar}
          />
        </Field>
      </div>
      <div className='px-4 pt-4 pb-2'>
        <OutputVars>
          <>
            <VarItem
              name='result'
              type='Array[x]'
              description={t(`${i18nPrefix}.outputVars.result`)}
            />
            <VarItem
              name='first_record'
              type='x'
              description={t(`${i18nPrefix}.outputVars.first_record`)}
            />
            <VarItem
              name='last_record'
              type='x'
              description={t(`${i18nPrefix}.outputVars.last_record`)}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
