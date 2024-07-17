import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import RadioCardItem from '../_base/components/radio-card-item'
import useConfig from './use-config'
import { WriteMode } from './types'
import type { AssignerNodeType, AssignerSupportVarType } from './types'
import Value from './components/value'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { type NodePanelProps, VarType } from '@/app/components/workflow/types'

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
    varType,
    handleWriteModeChange,
    writeModeTypes,
    handleValueChange,
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
          <div className='grid grid-cols-3 gap-2'>
            {writeModeTypes.map(type => (
              <RadioCardItem
                key={type}
                title={(varType === VarType.number && type === WriteMode.Append) ? t(`${i18nPrefix}.plus`) : t(`${i18nPrefix}.${type}`)}
                onSelect={handleWriteModeChange(type)}
                isSelected={inputs.writeMode === type}
                textCenter
              />
            ))}
          </div>
        </Field>
        {inputs.writeMode !== WriteMode.Clear && (
          <Field
            title={t(`${i18nPrefix}.setValue`)}
          >
            <Value
              nodeId={id}
              writeMode={inputs.writeMode}
              type={varType as AssignerSupportVarType}
              value={inputs.value}
              onChange={handleValueChange}
              readOnly={readOnly}
            />
          </Field>
        )}

      </div>
    </div>
  )
}

export default React.memo(Panel)
