import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import OptionCard from '../_base/components/option-card'
import Split from '../_base/components/split'
import useConfig from './use-config'
import SubVariablePicker from './components/sub-variable-picker'
import { type ListFilterNodeType, OrderBy } from './types'
import LimitConfig from './components/limit-config'
import FilterCondition from './components/filter-condition'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { type NodePanelProps } from '@/app/components/workflow/types'
import Switch from '@/app/components/base/switch'

const i18nPrefix = 'workflow.nodes.listFilter'

const Panel: FC<NodePanelProps<ListFilterNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    itemVarType,
    itemVarTypeShowName,
    hasSubVariable,
    handleVarChanges,
    filterVar,
    handleFilterEnabledChange,
    handleFilterChange,
    handleLimitChange,
    handleOrderByEnabledChange,
    handleOrderByKeyChange,
    handleOrderByTypeChange,
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
            typePlaceHolder='Array'
          />
        </Field>

        <Field
          title={t(`${i18nPrefix}.filterCondition`)}
          operations={
            <Switch
              defaultValue={inputs.filter_by?.enabled}
              onChange={handleFilterEnabledChange}
              size='md'
              disabled={readOnly}
            />
          }
        >
          {inputs.filter_by?.enabled
            ? (
              <FilterCondition
                condition={inputs.filter_by.conditions[0]}
                onChange={handleFilterChange}
                varType={itemVarType}
                hasSubVariable={hasSubVariable}
                readOnly={readOnly}
              />
            )
            : null}
        </Field>
        <Split />
        <Field
          title={t(`${i18nPrefix}.orderBy`)}
          operations={
            <Switch
              defaultValue={inputs.order_by?.enabled}
              onChange={handleOrderByEnabledChange}
              size='md'
              disabled={readOnly}
            />
          }
        >
          {inputs.order_by?.enabled
            ? (
              <div className='flex items-center justify-between'>
                {hasSubVariable && (
                  <div className='grow mr-2'>
                    <SubVariablePicker
                      value={inputs.order_by.key as string}
                      onChange={handleOrderByKeyChange}
                    />
                  </div>
                )}
                <div className={!hasSubVariable ? 'w-full grid grid-cols-2 gap-1' : 'shrink-0 flex space-x-1'}>
                  <OptionCard
                    title={t(`${i18nPrefix}.asc`)}
                    onSelect={handleOrderByTypeChange(OrderBy.ASC)}
                    selected={inputs.order_by.value === OrderBy.ASC}
                  />
                  <OptionCard
                    title={t(`${i18nPrefix}.desc`)}
                    onSelect={handleOrderByTypeChange(OrderBy.DESC)}
                    selected={inputs.order_by.value === OrderBy.DESC}
                  />
                </div>
              </div>
            )
            : null}
        </Field>
        <Split />
        <LimitConfig
          config={inputs.limit}
          onChange={handleLimitChange}
          readonly={readOnly}
        />
      </div>
      <Split />
      <div className='px-4 pt-4 pb-2'>
        <OutputVars>
          <>
            <VarItem
              name='result'
              type={`Array[${itemVarTypeShowName}]`}
              description={t(`${i18nPrefix}.outputVars.result`)}
            />
            <VarItem
              name='first_record'
              type={itemVarTypeShowName}
              description={t(`${i18nPrefix}.outputVars.first_record`)}
            />
            <VarItem
              name='last_record'
              type={itemVarTypeShowName}
              description={t(`${i18nPrefix}.outputVars.last_record`)}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
