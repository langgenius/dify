'use client'

import type {
  ComparisonOperator,
  ConditionMetricOption,
  EvaluationResourceProps,
  JudgmentConditionItem,
} from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { getAllowedOperators, requiresConditionValue, useEvaluationResource, useEvaluationStore } from '../../store'
import {
  buildConditionMetricOptions,
  getComparisonOperatorLabel,
  getConditionMetricValueTypeTranslationKey,
  groupConditionMetricOptions,
  isSelectorEqual,
  serializeVariableSelector,
} from '../../utils'

type ConditionMetricLabelProps = {
  metric?: ConditionMetricOption
  placeholder: string
}

type ConditionMetricSelectProps = {
  metric?: ConditionMetricOption
  metricOptions: ConditionMetricOption[]
  placeholder: string
  onChange: (variableSelector: [string, string]) => void
}

type ConditionOperatorSelectProps = {
  operator: ComparisonOperator
  operators: ComparisonOperator[]
  onChange: (operator: ComparisonOperator) => void
}

type ConditionValueInputProps = {
  metric?: ConditionMetricOption
  condition: JudgmentConditionItem
  onChange: (value: string | string[] | boolean | null) => void
}

type ConditionGroupProps = EvaluationResourceProps

const getMetricValueTypeIconClassName = (valueType: ConditionMetricOption['valueType']) => {
  if (valueType === 'number')
    return 'i-ri-hashtag'

  if (valueType === 'boolean')
    return 'i-ri-checkbox-circle-line'

  return 'i-ri-bar-chart-box-line'
}

const ConditionMetricLabel = ({
  metric,
  placeholder,
}: ConditionMetricLabelProps) => {
  if (!metric)
    return <span className="px-1 system-sm-regular text-components-input-text-placeholder">{placeholder}</span>

  return (
    <div className="flex min-w-0 items-center gap-2 px-1">
      <div className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark pr-1.5 pl-[5px] shadow-xs">
        <span className={cn(getMetricValueTypeIconClassName(metric.valueType), 'h-3 w-3 shrink-0 text-text-secondary')} />
        <span className="truncate system-xs-medium text-text-secondary">{metric.itemLabel}</span>
      </div>
      <span className="shrink-0 system-xs-regular text-text-tertiary">{metric.groupLabel}</span>
    </div>
  )
}

const ConditionMetricSelect = ({
  metric,
  metricOptions,
  placeholder,
  onChange,
}: ConditionMetricSelectProps) => {
  const { t } = useTranslation('evaluation')
  const groupedMetricOptions = useMemo(() => {
    return groupConditionMetricOptions(metricOptions)
  }, [metricOptions])

  return (
    <Select
      value={serializeVariableSelector(metric?.variableSelector)}
      onValueChange={(value) => {
        const nextMetric = metricOptions.find(option => serializeVariableSelector(option.variableSelector) === value)
        if (nextMetric)
          onChange(nextMetric.variableSelector)
      }}
    >
      <SelectTrigger className="h-auto bg-transparent px-1 py-1 hover:bg-transparent focus-visible:bg-transparent">
        <ConditionMetricLabel metric={metric} placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent popupClassName="w-[360px]">
        {groupedMetricOptions.map(group => (
          <SelectGroup key={group.label}>
            <SelectLabel className="px-3 pt-2 pb-1 system-xs-medium-uppercase text-text-tertiary">{group.label}</SelectLabel>
            {group.options.map(option => (
              <SelectItem key={option.id} value={serializeVariableSelector(option.variableSelector)}>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className={cn(getMetricValueTypeIconClassName(option.valueType), 'h-3.5 w-3.5 shrink-0 text-text-tertiary')} />
                  <span className="truncate">{option.itemLabel}</span>
                  <span className="ml-auto shrink-0 system-xs-medium text-text-quaternary">
                    {t(getConditionMetricValueTypeTranslationKey(option.valueType))}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

const ConditionOperatorSelect = ({
  operator,
  operators,
  onChange,
}: ConditionOperatorSelectProps) => {
  const { t } = useTranslation()

  return (
    <Select value={operator} onValueChange={value => value && onChange(value as ComparisonOperator)}>
      <SelectTrigger className="h-8 w-auto min-w-[88px] gap-1 rounded-md bg-transparent px-1.5 py-0 hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt">
        <span className="truncate system-xs-medium text-text-secondary">{getComparisonOperatorLabel(operator, t)}</span>
      </SelectTrigger>
      <SelectContent className="z-[1002]" popupClassName="w-[240px] bg-components-panel-bg-blur backdrop-blur-[10px]">
        {operators.map(nextOperator => (
          <SelectItem key={nextOperator} value={nextOperator}>
            {getComparisonOperatorLabel(nextOperator, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const ConditionValueInput = ({
  metric,
  condition,
  onChange,
}: ConditionValueInputProps) => {
  const { t } = useTranslation('evaluation')

  if (!metric || !requiresConditionValue(condition.comparisonOperator))
    return null

  if (metric.valueType === 'boolean') {
    return (
      <div className="px-2 py-1.5">
        <Select value={condition.value === null ? '' : String(condition.value)} onValueChange={nextValue => onChange(nextValue === 'true')}>
          <SelectTrigger className="bg-transparent hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt">
            <SelectValue placeholder={t('conditions.selectValue')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t('conditions.boolean.true')}</SelectItem>
            <SelectItem value="false">{t('conditions.boolean.false')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  const isMultiValue = condition.comparisonOperator === 'in' || condition.comparisonOperator === 'not in'
  const inputValue = Array.isArray(condition.value)
    ? condition.value.join(', ')
    : typeof condition.value === 'boolean'
      ? ''
      : condition.value ?? ''

  return (
    <div className="px-2 py-1.5">
      <Input
        type={metric.valueType === 'number' && !isMultiValue ? 'number' : 'text'}
        value={inputValue}
        className="border-none bg-transparent shadow-none hover:border-none hover:bg-state-base-hover-alt focus:border-none focus:bg-state-base-hover-alt focus:shadow-none"
        placeholder={t('conditions.valuePlaceholder')}
        onChange={(e) => {
          if (isMultiValue) {
            onChange(e.target.value.split(',').map(item => item.trim()).filter(Boolean))
            return
          }

          onChange(e.target.value === '' ? null : e.target.value)
        }}
      />
    </div>
  )
}

const ConditionGroup = ({
  resourceType,
  resourceId,
}: ConditionGroupProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const metricOptions = useMemo(() => buildConditionMetricOptions(resource.metrics), [resource.metrics])
  const logicalLabels = {
    and: t('conditions.logical.and'),
    or: t('conditions.logical.or'),
  }
  const setConditionLogicalOperator = useEvaluationStore(state => state.setConditionLogicalOperator)
  const removeCondition = useEvaluationStore(state => state.removeCondition)
  const updateConditionMetric = useEvaluationStore(state => state.updateConditionMetric)
  const updateConditionOperator = useEvaluationStore(state => state.updateConditionOperator)
  const updateConditionValue = useEvaluationStore(state => state.updateConditionValue)

  return (
    <div className="rounded-2xl border border-divider-subtle bg-components-card-bg p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-divider-subtle bg-background-default-subtle p-1">
            {(['and', 'or'] as const).map(operator => (
              <button
                key={operator}
                type="button"
                className={cn(
                  'rounded-md px-3 py-1.5 system-xs-medium-uppercase',
                  resource.judgmentConfig.logicalOperator === operator
                    ? 'bg-components-card-bg text-text-primary shadow-xs'
                    : 'text-text-tertiary',
                )}
                onClick={() => setConditionLogicalOperator(resourceType, resourceId, operator)}
              >
                {logicalLabels[operator]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {resource.judgmentConfig.conditions.map((condition) => {
          const metric = metricOptions.find(option => isSelectorEqual(option.variableSelector, condition.variableSelector))
          const allowedOperators = getAllowedOperators(resource.metrics, condition.variableSelector)
          const showValue = !!metric && requiresConditionValue(condition.comparisonOperator)

          return (
            <div key={condition.id} className="flex items-start overflow-hidden rounded-lg">
              <div className="min-w-0 flex-1 rounded-lg bg-components-input-bg-normal">
                <div className="flex items-center gap-0 pr-1">
                  <div className="min-w-0 flex-1 py-1">
                    <ConditionMetricSelect
                      metric={metric}
                      metricOptions={metricOptions}
                      placeholder={t('conditions.fieldPlaceholder')}
                      onChange={value => updateConditionMetric(resourceType, resourceId, condition.id, value)}
                    />
                  </div>
                  <div className="h-3 w-px bg-divider-regular" />
                  <ConditionOperatorSelect
                    operator={condition.comparisonOperator}
                    operators={allowedOperators}
                    onChange={value => updateConditionOperator(resourceType, resourceId, condition.id, value)}
                  />
                </div>
                {showValue && (
                  <div className="border-t border-divider-subtle">
                    <ConditionValueInput
                      metric={metric}
                      condition={condition}
                      onChange={value => updateConditionValue(resourceType, resourceId, condition.id, value)}
                    />
                  </div>
                )}
              </div>
              <div className="pt-1 pl-1">
                <Button
                  size="small"
                  variant="ghost"
                  aria-label={t('conditions.removeCondition')}
                  onClick={() => removeCondition(resourceType, resourceId, condition.id)}
                >
                  <span aria-hidden="true" className="i-ri-close-line h-4 w-4" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ConditionGroup
