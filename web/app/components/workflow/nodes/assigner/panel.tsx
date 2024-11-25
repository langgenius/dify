import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiDeleteBinLine,
} from '@remixicon/react'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import useConfig from './use-config'
import type { AssignerNodeType } from './types'
import ActionButton from '@/app/components/base/action-button'
import { type NodePanelProps } from '@/app/components/workflow/types'

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
    <div className='flex py-2 flex-col items-start self-stretch'>
      <div className='flex flex-col justify-center items-start gap-1 px-4 py-2 w-full self-stretch'>
        <div className='flex items-start gap-2 self-stretch'>
          <div className='flex flex-col justify-center items-start flex-grow text-text-secondary system-sm-semibold-uppercase'>{t(`${i18nPrefix}.variables`)}</div>
          <ActionButton>
            <RiAddLine className='w-4 h-4 shrink-0 text-text-tertiary' />
          </ActionButton>
        </div>
        <div className='flex items-start gap-1 self-stretch'>
          <div className='flex flex-col items-start gap-1 flex-grow'>
            <div className='flex items-center gap-1 self-stretch'>
              <VarReferencePicker
                readonly={readOnly}
                nodeId={id}
                isShowNodeName
                value={inputs.assigned_variable_selector || []}
                onChange={handleAssignedVarChanges}
                filterVar={filterAssignedVar}
                className='w-full'
              />
            </div>
          </div>
          <ActionButton size='l' className='flex-shrink-0 group hover:!bg-state-destructive-hover'>
            <RiDeleteBinLine className='text-text-tertiary w-4 h-4 group-hover:text-text-destructive' />
          </ActionButton>
        </div>
        {/* <Field
          title={t(`${i18nPrefix}.writeMode`)}
        >
          <div className={cn('grid gap-2 grid-cols-3')}>
            {writeModeTypes.map(type => (
              <OptionCard
                key={type}
                title={t(`${i18nPrefix}.${type}`)}
                onSelect={handleWriteModeChange(type)}
                selected={inputs.write_mode === type}
                disabled={!isSupportAppend && type === WriteMode.Append}
                tooltip={type === WriteMode.Append ? t(`${i18nPrefix}.writeModeTip`)! : undefined}
              />
            ))}
          </div>
        </Field> */}
        {/* {inputs.write_mode !== WriteMode.Clear && (
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
        )} */}

      </div>
    </div>
  )
}

export default React.memo(Panel)
