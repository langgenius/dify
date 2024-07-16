import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import type { AssignerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.assigner'

const Panel: FC<NodePanelProps<AssignerNodeType>> = ({
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
          title={t(`${i18nPrefix}.assignedVariable`)}
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
        <Field
          title={t(`${i18nPrefix}.writeMode`)}
        >
          aa
        </Field>
        <Field
          title={t(`${i18nPrefix}.setValue`)}
        >
          aa
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
