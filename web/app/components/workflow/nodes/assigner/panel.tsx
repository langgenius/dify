import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import OptionCard from '../_base/components/option-card'
import useConfig from './use-config'
import { WriteMode } from './types'
import type { AssignerNodeType } from './types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { type NodePanelProps } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.assigner'

const Panel: FC<NodePanelProps<AssignerNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handleAssignedVarChanges,
    isSupportAppend,
    writeModeTypes,
    handleWriteModeChange,
    filterAssignedVar,
    filterToAssignedVar,
    handleToAssignedVarChange,
    toAssignedVarType,
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
            value={inputs.assigned_variable_selector || []}
            onChange={handleAssignedVarChanges}
            filterVar={filterAssignedVar}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.writeMode`)}
          tooltip={t(`${i18nPrefix}.writeModeTip`)!}
        >
          <div className={cn('grid gap-2 grid-cols-3')}>
            {writeModeTypes.map(type => (
              <OptionCard
                key={type}
                title={t(`${i18nPrefix}.${type}`)}
                onSelect={handleWriteModeChange(type)}
                selected={inputs.write_mode === type}
                disabled={!isSupportAppend && type === WriteMode.Append}
              />
            ))}
          </div>
        </Field>
        {inputs.write_mode !== WriteMode.Clear && (
          <Field
            title={t(`${i18nPrefix}.setVariable`)}
          >
            <VarReferencePicker
              readonly={readOnly}
              nodeId={id}
              isShowNodeName
              value={inputs.input_variable_selector || []}
              onChange={handleToAssignedVarChange}
              filterVar={filterToAssignedVar}
              valueTypePlaceHolder={toAssignedVarType}
            />
          </Field>
        )}

      </div>
    </div>
  )
}

export default React.memo(Panel)
