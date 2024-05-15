import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import Split from '../_base/components/split'
import type { IterationNodeType } from './types'
import useConfig from './use-config'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'

const i18nPrefix = 'workflow.nodes.iteration'

const Panel: FC<NodePanelProps<IterationNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    filterInputVar,
    handleInputChange,
    childrenNodeVars,
    iterationChildrenNodes,
    handleOutputVarChange,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.input`)}
        >
          <VarReferencePicker
            readonly={readOnly}
            nodeId={id}
            isShowNodeName
            value={inputs.iterator_selector || []}
            onChange={handleInputChange}
            filterVar={filterInputVar}
          />
        </Field>
      </div>
      <Split />
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.output`)}
        >
          <VarReferencePicker
            readonly={readOnly}
            nodeId={id}
            isShowNodeName
            value={inputs.output_selector || []}
            onChange={handleOutputVarChange}
            availableNodes={iterationChildrenNodes}
            availableVars={childrenNodeVars}
          />
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
