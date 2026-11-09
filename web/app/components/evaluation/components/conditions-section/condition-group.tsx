'use client'

import type {
  ComparisonOperator,
  ConditionMetricOption,
  EvaluationResourceProps,
  JudgmentConditionItem,
} from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
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
import BlockIcon from '@/app/components/workflow/block-icon'
import {
  getAllowedOperators,
  getIncompleteConditionIds,
  requiresConditionValue,
  useConditionErrorsVisible,
  useEvaluationResource,
  useEvaluationStore,
} from '../../store'
import {
  buildConditionMetricOptions,
  getComparisonOperatorLabel,
  getConditionMetricValueTypeTranslationKey,
  groupConditionMetricOptions,
  isSelectorEqual,
  serializeVariableSelector,
} from '../../utils'
import { getEvaluationNodeBlockType } from '../metric-selector/utils'

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

const ConditionMetricLabel = ({ metric, placeholder }: ConditionMetricLabelProps) => {
  if (!metric)
    return (
      <span className="px-1 system-sm-regular text-components-input-text-placeholder">
        {placeholder}
      </span>
    )

  if (metric.kind === 'builtin' && metric.nodeInfo) {
    return (
      <div className="flex min-w-0 items-center px-1">
        <div className="inline-flex h-6 min-w-0 items-center gap-0.5 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark py-1 ps-[5px] pe-1.5 shadow-xs">
          <span className="truncate system-xs-medium text-text-secondary">{metric.groupLabel}</span>
          <span className="system-xs-regular text-divider-deep">/</span>
          <span className="flex min-w-0 shrink-0 items-center gap-0.5">
            <BlockIcon
              type={getEvaluationNodeBlockType(metric.nodeInfo)}
              size="xs"
              className="size-3 rounded-[5px]"
            />
            <span className="max-w-[96px] truncate system-xs-medium text-text-secondary">
              {metric.itemLabel}
            </span>
          </span>
          <span className="shrink-0 system-xs-regular text-text-tertiary">{metric.valueType}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 items-center px-1">
      <div className="inline-flex h-6 min-w-0 items-center gap-0.5 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark py-1 ps-[5px] pe-1.5 shadow-xs">
        <span className="truncate system-xs-medium text-text-secondary">{metric.itemLabel}</span>
        <span className="shrink-0 system-xs-regular text-text-tertiary">{metric.valueType}</span>
      </div>
    </div>
  )
}

const ConditionMetricSelect = ({
  metric,
  metricOptions,
  placeholder,
  onChange,
}: ConditionMetricSelectProps) => {
  const { t } = useTranslation(['evaluation'])
  const groupedMetricOptions = useMemo(() => {
    return groupConditionMetricOptions(metricOptions)
  }, [metricOptions])

  return (
    <Select
      value={serializeVariableSelector(metric?.variableSelector)}
      onValueChange={(value) => {
        const nextMetric = metricOptions.find(
          (option) => serializeVariableSelector(option.variableSelector) === value,
        )
        if (nextMetric) onChange(nextMetric.variableSelector)
      }}
    >
      <SelectTrigger
        aria-label={t(($) => $['conditions.fieldPlaceholder'])}
        className="h-auto bg-transparent px-1 py-1 hover:bg-transparent focus-visible:bg-transparent"
      >
        <ConditionMetricLabel metric={metric} placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="w-[360px]">
        {groupedMetricOptions.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel className="px-3 pt-2 pb-1 system-xs-medium-uppercase text-text-tertiary">
              {group.label}
            </SelectLabel>
            {group.options.map((option) => (
              <SelectItem
                key={option.id}
                value={serializeVariableSelector(option.variableSelector)}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{option.itemLabel}</span>
                  <span className="ms-auto shrink-0 system-xs-medium text-text-quaternary">
                    {t(($) => $[getConditionMetricValueTypeTranslationKey(option.valueType)])}
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
  const { t } = useTranslation(['workflowLogic'])
  const { t: tEvaluation } = useTranslation(['evaluation'])

  return (
    <Select
      value={operator}
      onValueChange={(value) => value && onChange(value as ComparisonOperator)}
    >
      <SelectTrigger
        aria-label={tEvaluation(($) => $['conditions.operator'])}
        className="h-8 w-auto min-w-14 shrink-0 gap-1 rounded-md bg-transparent px-1.5 py-0 hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt"
      >
        <span className="truncate system-xs-medium text-text-secondary">
          {getComparisonOperatorLabel(operator, t)}
        </span>
      </SelectTrigger>
      <SelectContent className="z-1002 w-[160px] bg-components-panel-bg-blur backdrop-blur-[10px]">
        {operators.map((nextOperator) => (
          <SelectItem key={nextOperator} value={nextOperator}>
            {getComparisonOperatorLabel(nextOperator, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const ConditionValueInput = ({ metric, condition, onChange }: ConditionValueInputProps) => {
  const { t } = useTranslation(['evaluation'])

  if (!metric || !requiresConditionValue(condition.comparisonOperator)) return null

  if (metric.valueType === 'boolean') {
    return (
      <div className="py-1">
        <Select
          value={condition.value === null ? '' : String(condition.value)}
          onValueChange={(nextValue) => onChange(nextValue === 'true')}
        >
          <SelectTrigger
            aria-label={t(($) => $['conditions.selectValue'])}
            className="bg-transparent hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt"
          >
            <SelectValue placeholder={t(($) => $['conditions.selectValue'])} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t(($) => $['conditions.boolean.true'])}</SelectItem>
            <SelectItem value="false">{t(($) => $['conditions.boolean.false'])}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  const isMultiValue =
    condition.comparisonOperator === 'in' || condition.comparisonOperator === 'not in'
  const inputValue = Array.isArray(condition.value)
    ? condition.value.join(', ')
    : typeof condition.value === 'boolean'
      ? ''
      : (condition.value ?? '')

  return (
    <div className="py-1">
      <Input
        type={metric.valueType === 'number' && !isMultiValue ? 'number' : 'text'}
        value={inputValue}
        aria-label={t(($) => $['conditions.valuePlaceholder'])}
        className="border-none bg-transparent shadow-none hover:border-none hover:bg-state-base-hover-alt focus:border-none focus:bg-state-base-hover-alt focus:shadow-none"
        placeholder={t(($) => $['conditions.valuePlaceholder'])}
        onChange={(e) => {
          if (isMultiValue) {
            onChange(
              e.target.value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            )
            return
          }

          onChange(e.target.value === '' ? null : e.target.value)
        }}
      />
    </div>
  )
}

const ConditionGroup = ({ resourceType, resourceId }: ConditionGroupProps) => {
  const { t } = useTranslation(['evaluation'])
  const resource = useEvaluationResource(resourceType, resourceId)
  const metricOptions = useMemo(
    () => buildConditionMetricOptions(resource.metrics, resourceType, resourceId),
    [resource.metrics, resourceType, resourceId],
  )
  const logicalOperator = resource.judgmentConfig.logicalOperator
  const logicalLabels = {
    and: t(($) => $['conditions.logical.and']),
    or: t(($) => $['conditions.logical.or']),
  }
  const hasMultipleConditions = resource.judgmentConfig.conditions.length > 1
  const showErrors = useConditionErrorsVisible(resourceType, resourceId)
  const incompleteConditionIds = new Set(
    showErrors ? getIncompleteConditionIds(resource, resourceType, resourceId) : [],
  )
  const setConditionLogicalOperator = useEvaluationStore(
    (state) => state.setConditionLogicalOperator,
  )
  const removeCondition = useEvaluationStore((state) => state.removeCondition)
  const updateConditionMetric = useEvaluationStore((state) => state.updateConditionMetric)
  const updateConditionOperator = useEvaluationStore((state) => state.updateConditionOperator)
  const updateConditionValue = useEvaluationStore((state) => state.updateConditionValue)
  const toggleLogicalOperator = () => {
    setConditionLogicalOperator(resourceType, resourceId, logicalOperator === 'and' ? 'or' : 'and')
  }

  return (
    <div className="rounded-2xl border border-divider-subtle bg-components-card-bg p-4">
      <div className={cn('relative', hasMultipleConditions && 'ps-[48px]')}>
        {hasMultipleConditions && (
          <div className="absolute inset-s-0 top-0 bottom-0 w-[48px]">
            <div className="absolute inset-s-[34px] top-4 bottom-4 w-2.5 rounded-s-[8px] border border-e-0 border-divider-deep" />
            <div className="absolute inset-e-0 top-1/2 h-[29px] w-4 -translate-y-1/2 bg-components-card-bg" />
            <button
              type="button"
              aria-label={logicalLabels[logicalOperator]}
              className="absolute inset-e-1 top-1/2 flex h-[21px] -translate-y-1/2 cursor-pointer items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-1 text-[10px] font-semibold text-text-accent-secondary shadow-xs select-none"
              onClick={toggleLogicalOperator}
            >
              {logicalLabels[logicalOperator]}
              <span aria-hidden="true" className="ms-0.5 i-ri-loop-left-line h-3 w-3" />
            </button>
          </div>
        )}

        <div className="space-y-3">
          {resource.judgmentConfig.conditions.map((condition) => {
            const metric = metricOptions.find((option) =>
              isSelectorEqual(option.variableSelector, condition.variableSelector),
            )
            const allowedOperators = getAllowedOperators(
              resource.metrics,
              condition.variableSelector,
              resourceType,
              resourceId,
            )
            const showValue = !!metric && requiresConditionValue(condition.comparisonOperator)
            const errorMessage = incompleteConditionIds.has(condition.id)
              ? metric
                ? t(($) => $['conditions.valueRequired'])
                : t(($) => $['conditions.selectFieldFirst'])
              : null
            const errorId = `condition-error-${condition.id}`

            return (
              <div key={condition.id} className="flex items-start overflow-hidden rounded-lg">
                <div
                  className={cn(
                    'min-w-0 flex-1 rounded-lg bg-components-input-bg-normal',
                    errorMessage && 'ring-1 ring-components-input-border-destructive ring-inset',
                  )}
                  aria-describedby={errorMessage ? errorId : undefined}
                >
                  <div className="flex items-center gap-0 pe-1">
                    <div className="min-w-0 flex-1 py-1">
                      <ConditionMetricSelect
                        metric={metric}
                        metricOptions={metricOptions}
                        placeholder={t(($) => $['conditions.fieldPlaceholder'])}
                        onChange={(value) =>
                          updateConditionMetric(resourceType, resourceId, condition.id, value)
                        }
                      />
                    </div>
                    <div className="h-3 w-px shrink-0 bg-divider-regular" />
                    <ConditionOperatorSelect
                      operator={condition.comparisonOperator}
                      operators={allowedOperators}
                      onChange={(value) =>
                        updateConditionOperator(resourceType, resourceId, condition.id, value)
                      }
                    />
                    {/* Keep the value on the same line so a condition reads as one statement. */}
                    {showValue && (
                      <>
                        <div className="h-3 w-px shrink-0 bg-divider-regular" />
                        <div
                          className={cn(
                            'shrink-0',
                            metric?.valueType === 'number' &&
                              condition.comparisonOperator !== 'in' &&
                              condition.comparisonOperator !== 'not in'
                              ? 'w-32'
                              : 'w-40',
                          )}
                        >
                          <ConditionValueInput
                            metric={metric}
                            condition={condition}
                            onChange={(value) =>
                              updateConditionValue(resourceType, resourceId, condition.id, value)
                            }
                          />
                        </div>
                      </>
                    )}
                  </div>
                  {errorMessage && (
                    <p
                      id={errorId}
                      className="border-t border-divider-subtle px-3 py-1.5 system-xs-regular text-text-destructive"
                    >
                      {errorMessage}
                    </p>
                  )}
                </div>
                <div className="ps-1 pt-1">
                  <IconButton
                    size="lg"
                    tone="destructive"
                    aria-label={t(($) => $['conditions.removeCondition'])}
                    onClick={() => removeCondition(resourceType, resourceId, condition.id)}
                  >
                    <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ConditionGroup
