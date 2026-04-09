'use client'

import type {
  ComparisonOperator,
  EvaluationFieldOption,
  EvaluationResourceProps,
  JudgmentConditionGroup,
} from '../../types'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/base/ui/select'
import { cn } from '@/utils/classnames'
import { getEvaluationMockConfig } from '../../mock'
import { getAllowedOperators, requiresConditionValue, useEvaluationStore } from '../../store'
import { getFieldTypeIconClassName, getOperatorLabel, groupFieldOptions } from '../../utils'

type ConditionFieldLabelProps = {
  field?: EvaluationFieldOption
  placeholder: string
}

type ConditionFieldSelectProps = {
  field?: EvaluationFieldOption
  fieldOptions: EvaluationFieldOption[]
  placeholder: string
  onChange: (fieldId: string) => void
}

type ConditionOperatorSelectProps = {
  field?: EvaluationFieldOption
  operator: ComparisonOperator
  operators: ComparisonOperator[]
  onChange: (operator: ComparisonOperator) => void
}

type FieldValueInputProps = {
  field?: EvaluationFieldOption
  operator: ComparisonOperator
  value: string | number | boolean | null
  onChange: (value: string | number | boolean | null) => void
}

type ConditionGroupProps = EvaluationResourceProps & {
  group: JudgmentConditionGroup
  index: number
}

const ConditionFieldLabel = ({
  field,
  placeholder,
}: ConditionFieldLabelProps) => {
  if (!field)
    return <span className="px-1 system-sm-regular text-components-input-text-placeholder">{placeholder}</span>

  return (
    <div className="flex min-w-0 items-center gap-2 px-1">
      <div className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark pr-1.5 pl-[5px] shadow-xs">
        <span className={cn(getFieldTypeIconClassName(field.type), 'h-3 w-3 shrink-0 text-text-secondary')} />
        <span className="truncate system-xs-medium text-text-secondary">{field.label}</span>
      </div>
      <span className="shrink-0 system-xs-regular text-text-tertiary">{field.type}</span>
    </div>
  )
}

const ConditionFieldSelect = ({
  field,
  fieldOptions,
  placeholder,
  onChange,
}: ConditionFieldSelectProps) => {
  return (
    <Select value={field?.id ?? ''} onValueChange={value => value && onChange(value)}>
      <SelectTrigger className="h-auto bg-transparent px-1 py-1 hover:bg-transparent focus-visible:bg-transparent">
        <ConditionFieldLabel field={field} placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent popupClassName="w-[320px]">
        {groupFieldOptions(fieldOptions).map(([groupName, fields]) => (
          <SelectGroup key={groupName}>
            <SelectGroupLabel className="px-3 pt-2 pb-1 system-xs-medium-uppercase text-text-tertiary">{groupName}</SelectGroupLabel>
            {fields.map(option => (
              <SelectItem key={option.id} value={option.id}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn(getFieldTypeIconClassName(option.type), 'h-3.5 w-3.5 shrink-0 text-text-tertiary')} />
                  <span className="truncate">{option.label}</span>
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
  field,
  operator,
  operators,
  onChange,
}: ConditionOperatorSelectProps) => {
  const { t } = useTranslation('evaluation')

  return (
    <Select value={operator} onValueChange={value => value && onChange(value as ComparisonOperator)}>
      <SelectTrigger className="h-8 w-auto min-w-[88px] gap-1 rounded-md bg-transparent px-1.5 py-0 hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt">
        <span className="truncate system-xs-medium text-text-secondary">{getOperatorLabel(operator, field?.type, t)}</span>
      </SelectTrigger>
      <SelectContent className="z-[1002]" popupClassName="w-[240px] bg-components-panel-bg-blur backdrop-blur-[10px]">
        {operators.map(nextOperator => (
          <SelectItem key={nextOperator} value={nextOperator}>
            {getOperatorLabel(nextOperator, field?.type, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const FieldValueInput = ({
  field,
  operator,
  value,
  onChange,
}: FieldValueInputProps) => {
  const { t } = useTranslation('evaluation')

  if (!field || !requiresConditionValue(operator))
    return null

  if (field.type === 'boolean') {
    return (
      <div className="px-2 py-1.5">
        <Select value={value === null ? '' : String(value)} onValueChange={nextValue => onChange(nextValue === 'true')}>
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

  if (field.type === 'enum') {
    return (
      <div className="px-2 py-1.5">
        <Select value={typeof value === 'string' ? value : ''} onValueChange={nextValue => onChange(nextValue)}>
          <SelectTrigger className="bg-transparent hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt">
            <SelectValue placeholder={t('conditions.selectValue')} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className="px-2 py-1.5">
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        value={value === null || typeof value === 'boolean' ? '' : value}
        className="border-none bg-transparent shadow-none hover:border-none hover:bg-state-base-hover-alt focus:border-none focus:bg-state-base-hover-alt focus:shadow-none"
        placeholder={t('conditions.valuePlaceholder')}
        onChange={(e) => {
          if (field.type === 'number') {
            const nextValue = e.target.value
            onChange(nextValue === '' ? null : Number(nextValue))
            return
          }

          onChange(e.target.value)
        }}
      />
    </div>
  )
}

const ConditionGroup = ({
  resourceType,
  resourceId,
  group,
  index,
}: ConditionGroupProps) => {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)
  const logicalLabels = {
    and: t('conditions.logical.and'),
    or: t('conditions.logical.or'),
  }
  const removeConditionGroup = useEvaluationStore(state => state.removeConditionGroup)
  const setConditionGroupOperator = useEvaluationStore(state => state.setConditionGroupOperator)
  const addConditionItem = useEvaluationStore(state => state.addConditionItem)
  const removeConditionItem = useEvaluationStore(state => state.removeConditionItem)
  const updateConditionField = useEvaluationStore(state => state.updateConditionField)
  const updateConditionOperator = useEvaluationStore(state => state.updateConditionOperator)
  const updateConditionValue = useEvaluationStore(state => state.updateConditionValue)

  return (
    <div className="rounded-2xl border border-divider-subtle bg-components-card-bg p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge>{t('conditions.groupLabel', { index: index + 1 })}</Badge>
          <div className="flex rounded-lg border border-divider-subtle bg-background-default-subtle p-1">
            {(['and', 'or'] as const).map(operator => (
              <button
                key={operator}
                type="button"
                className={cn(
                  'rounded-md px-3 py-1.5 system-xs-medium-uppercase',
                  group.logicalOperator === operator
                    ? 'bg-components-card-bg text-text-primary shadow-xs'
                    : 'text-text-tertiary',
                )}
                onClick={() => setConditionGroupOperator(resourceType, resourceId, group.id, operator)}
              >
                {logicalLabels[operator]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="small" variant="ghost" onClick={() => addConditionItem(resourceType, resourceId, group.id)}>
            <span aria-hidden="true" className="mr-1 i-ri-add-line h-4 w-4" />
            {t('conditions.addCondition')}
          </Button>
          <Button
            size="small"
            variant="ghost"
            aria-label={t('conditions.removeGroup')}
            onClick={() => removeConditionGroup(resourceType, resourceId, group.id)}
          >
            <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {group.items.map((item) => {
          const field = config.fieldOptions.find(option => option.id === item.fieldId)
          const allowedOperators = getAllowedOperators(resourceType, item.fieldId)
          const showValue = !!field && requiresConditionValue(item.operator)

          return (
            <div key={item.id} className="flex items-start overflow-hidden rounded-lg">
              <div className="min-w-0 flex-1 rounded-lg bg-components-input-bg-normal">
                <div className="flex items-center gap-0 pr-1">
                  <div className="min-w-0 flex-1 py-1">
                    <ConditionFieldSelect
                      field={field}
                      fieldOptions={config.fieldOptions}
                      placeholder={t('conditions.fieldPlaceholder')}
                      onChange={value => updateConditionField(resourceType, resourceId, group.id, item.id, value)}
                    />
                  </div>
                  <div className="h-3 w-px bg-divider-regular" />
                  <ConditionOperatorSelect
                    field={field}
                    operator={item.operator}
                    operators={allowedOperators}
                    onChange={value => updateConditionOperator(resourceType, resourceId, group.id, item.id, value)}
                  />
                </div>
                {showValue && (
                  <div className="border-t border-divider-subtle">
                    <FieldValueInput
                      field={field}
                      operator={item.operator}
                      value={item.value}
                      onChange={value => updateConditionValue(resourceType, resourceId, group.id, item.id, value)}
                    />
                  </div>
                )}
              </div>
              <div className="pt-1 pl-1">
                <Button
                  size="small"
                  variant="ghost"
                  aria-label={t('conditions.removeCondition')}
                  onClick={() => removeConditionItem(resourceType, resourceId, group.id, item.id)}
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
