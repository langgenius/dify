import type { FC } from 'react'
import type { ListFilterNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import ExtractInput from '@/app/components/workflow/nodes/list-operator/components/extract-input'
import OptionCard from '../_base/components/option-card'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import Split from '../_base/components/split'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import FilterCondition from './components/filter-condition'
import LimitConfig from './components/limit-config'
import SubVariablePicker from './components/sub-variable-picker'
import { OrderBy } from './types'
import useConfig from './use-config'

const i18nPrefix = 'nodes.listFilter'

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
    handleExtractsEnabledChange,
    handleExtractsChange,
    handleLimitChange,
    handleOrderByEnabledChange,
    handleOrderByKeyChange,
    handleOrderByTypeChange,
  } = useConfig(id, data)

  return (
    <div className="pt-2">
      <div className="space-y-4 px-4">
        <Field
          title={t(`${i18nPrefix}.inputVar`, { ns: 'workflow' })}
          required
        >
          <VarReferencePicker
            readonly={readOnly}
            nodeId={id}
            isShowNodeName
            value={inputs.variable || []}
            onChange={handleVarChanges}
            filterVar={filterVar}
            isSupportFileVar={false}
            typePlaceHolder="Array"
          />
        </Field>

        <Field
          title={t(`${i18nPrefix}.filterCondition`, { ns: 'workflow' })}
          operations={(
            <Switch
              defaultValue={inputs.filter_by?.enabled}
              onChange={handleFilterEnabledChange}
              size="md"
              disabled={readOnly}
            />
          )}
        >
          {inputs.filter_by?.enabled
            ? (
                <FilterCondition
                  condition={inputs.filter_by.conditions[0]}
                  onChange={handleFilterChange}
                  varType={itemVarType}
                  hasSubVariable={hasSubVariable}
                  readOnly={readOnly}
                  nodeId={id}
                />
              )
            : null}
        </Field>
        <Split />
        <Field
          title={t(`${i18nPrefix}.extractsCondition`, { ns: 'workflow' })}
          operations={(
            <Switch
              defaultValue={inputs.extract_by?.enabled}
              onChange={handleExtractsEnabledChange}
              size="md"
              disabled={readOnly}
            />
          )}
        >
          {inputs.extract_by?.enabled
            ? (
                <div className="flex items-center justify-between">
                  <div className="mr-2 grow">
                    <ExtractInput
                      value={inputs.extract_by.serial as string}
                      onChange={handleExtractsChange}
                      readOnly={readOnly}
                      nodeId={id}
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
        <Split />
        <Field
          title={t(`${i18nPrefix}.orderBy`, { ns: 'workflow' })}
          operations={(
            <Switch
              defaultValue={inputs.order_by?.enabled}
              onChange={handleOrderByEnabledChange}
              size="md"
              disabled={readOnly}
            />
          )}
        >
          {inputs.order_by?.enabled
            ? (
                <div className="flex items-center justify-between">
                  {hasSubVariable && (
                    <div className="mr-2 grow">
                      <SubVariablePicker
                        value={inputs.order_by.key as string}
                        onChange={handleOrderByKeyChange}
                      />
                    </div>
                  )}
                  <div className={!hasSubVariable ? 'grid w-full grid-cols-2 gap-1' : 'flex shrink-0 space-x-1'}>
                    <OptionCard
                      title={t(`${i18nPrefix}.asc`, { ns: 'workflow' })}
                      onSelect={handleOrderByTypeChange(OrderBy.ASC)}
                      selected={inputs.order_by.value === OrderBy.ASC}
                    />
                    <OptionCard
                      title={t(`${i18nPrefix}.desc`, { ns: 'workflow' })}
                      onSelect={handleOrderByTypeChange(OrderBy.DESC)}
                      selected={inputs.order_by.value === OrderBy.DESC}
                    />
                  </div>
                </div>
              )
            : null}
        </Field>
        <Split />
      </div>
      <div>
        <OutputVars>
          <>
            <VarItem
              name="result"
              type={`Array[${itemVarTypeShowName}]`}
              description={t(`${i18nPrefix}.outputVars.result`, { ns: 'workflow' })}
            />
            <VarItem
              name="first_record"
              type={itemVarTypeShowName}
              description={t(`${i18nPrefix}.outputVars.first_record`, { ns: 'workflow' })}
            />
            <VarItem
              name="last_record"
              type={itemVarTypeShowName}
              description={t(`${i18nPrefix}.outputVars.last_record`, { ns: 'workflow' })}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
