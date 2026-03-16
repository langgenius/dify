'use client'

import type { TFunction } from 'i18next'
import type { ChangeEvent, ReactNode } from 'react'
import type {
  ComparisonOperator,
  CustomMetricMapping,
  EvaluationFieldOption,
  EvaluationMetric,
  EvaluationResourceType,
  JudgmentConditionGroup,
} from './types'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiFileUploadLine,
  RiFlaskLine,
  RiLoader4Line,
} from '@remixicon/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import dayjs from '@/app/components/base/date-and-time-picker/utils/dayjs'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/base/ui/select'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { cn } from '@/utils/classnames'
import { getEvaluationMockConfig } from './mock'
import {
  getAllowedOperators,
  isCustomMetricConfigured,
  isEvaluationRunnable,
  requiresConditionValue,
  useEvaluationResource,
  useEvaluationStore,
} from './store'

type EvaluationProps = {
  resourceType: EvaluationResourceType
  resourceId: string
}

const TAB_CLASS_NAME = 'flex-1 rounded-lg px-3 py-2 text-left system-sm-medium'

const encodeModelSelection = (provider: string, model: string) => `${provider}::${model}`

const decodeModelSelection = (judgeModelId: string | null) => {
  if (!judgeModelId)
    return undefined

  const [provider, model] = judgeModelId.split('::')
  if (!provider || !model)
    return undefined

  return { provider, model }
}

const compactOperatorLabels: Partial<Record<ComparisonOperator, string>> = {
  is: '=',
  is_not: '!=',
  greater_than: '>',
  less_than: '<',
  greater_or_equal: '>=',
  less_or_equal: '<=',
}

const groupFieldOptions = (fieldOptions: EvaluationFieldOption[]) => {
  return Object.entries(fieldOptions.reduce<Record<string, EvaluationFieldOption[]>>((acc, field) => {
    acc[field.group] = [...(acc[field.group] ?? []), field]
    return acc
  }, {}))
}

const getOperatorLabel = (
  operator: ComparisonOperator,
  fieldType: EvaluationFieldOption['type'] | undefined,
  t: TFunction<'evaluation'>,
) => {
  if (fieldType === 'number' && compactOperatorLabels[operator])
    return compactOperatorLabels[operator] as string

  return t(`conditions.operators.${operator}` as const)
}

const getFieldTypeIconClassName = (fieldType: EvaluationFieldOption['type']) => {
  if (fieldType === 'number')
    return 'i-ri-hashtag'

  if (fieldType === 'boolean')
    return 'i-ri-checkbox-circle-line'

  if (fieldType === 'enum')
    return 'i-ri-list-check-2'

  if (fieldType === 'time')
    return 'i-ri-time-line'

  return 'i-ri-text'
}

const ConditionFieldLabel = ({
  field,
  placeholder,
}: {
  field?: EvaluationFieldOption
  placeholder: string
}) => {
  if (!field)
    return <span className="px-1 text-components-input-text-placeholder system-sm-regular">{placeholder}</span>

  return (
    <div className="flex min-w-0 items-center gap-2 px-1">
      <div className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark pl-[5px] pr-1.5 shadow-xs">
        <span className={cn(getFieldTypeIconClassName(field.type), 'h-3 w-3 shrink-0 text-text-secondary')} />
        <span className="truncate text-text-secondary system-xs-medium">{field.label}</span>
      </div>
      <span className="shrink-0 text-text-tertiary system-xs-regular">{field.type}</span>
    </div>
  )
}

const SectionHeader = ({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) => {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-text-primary system-md-semibold">{title}</div>
        <div className="mt-1 text-text-tertiary system-sm-regular">{description}</div>
      </div>
      {action}
    </div>
  )
}

const FieldValueInput = ({
  field,
  operator,
  value,
  onChange,
}: {
  field?: EvaluationFieldOption
  operator: ComparisonOperator
  value: string | number | boolean | null
  onChange: (value: string | number | boolean | null) => void
}) => {
  const { t } = useTranslation('evaluation')

  if (!field || !requiresConditionValue(operator))
    return null

  if (field.type === 'time') {
    const selectedTime = typeof value === 'string' && value ? dayjs(value) : undefined

    return (
      <div className="px-2 py-1.5">
        <DatePicker
          value={selectedTime}
          onChange={date => onChange(date ? date.toISOString() : null)}
          onClear={() => onChange(null)}
          placeholder={t('conditions.selectTime')}
          triggerWrapClassName="w-full"
          popupZIndexClassname="z-[1002]"
          renderTrigger={({ handleClickTrigger }) => (
            <button
              type="button"
              className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-state-base-hover-alt"
              onClick={handleClickTrigger}
            >
              <span className={cn(
                'min-w-0 flex-1 truncate system-sm-regular',
                selectedTime ? 'text-text-secondary' : 'text-components-input-text-placeholder',
              )}
              >
                {selectedTime ? selectedTime.format('MMM D, YYYY h:mm A') : t('conditions.selectTime')}
              </span>
              <span className="i-ri-calendar-line h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary" />
            </button>
          )}
        />
      </div>
    )
  }

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

const ConditionFieldSelect = ({
  field,
  fieldOptions,
  placeholder,
  onChange,
}: {
  field?: EvaluationFieldOption
  fieldOptions: EvaluationFieldOption[]
  placeholder: string
  onChange: (fieldId: string) => void
}) => {
  return (
    <Select value={field?.id ?? ''} onValueChange={value => value && onChange(value)}>
      <SelectTrigger className="h-auto bg-transparent px-1 py-1 hover:bg-transparent focus-visible:bg-transparent">
        <ConditionFieldLabel field={field} placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent popupClassName="w-[320px]">
        {groupFieldOptions(fieldOptions).map(([groupName, fields]) => (
          <SelectGroup key={groupName}>
            <SelectGroupLabel className="px-3 pb-1 pt-2 text-text-tertiary system-xs-medium-uppercase">{groupName}</SelectGroupLabel>
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
}: {
  field?: EvaluationFieldOption
  operator: ComparisonOperator
  operators: ComparisonOperator[]
  onChange: (operator: ComparisonOperator) => void
}) => {
  const { t } = useTranslation('evaluation')

  return (
    <Select value={operator} onValueChange={value => value && onChange(value as ComparisonOperator)}>
      <SelectTrigger className="h-8 w-auto min-w-[88px] gap-1 rounded-md bg-transparent px-1.5 py-0 hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt">
        <span className="truncate text-text-secondary system-xs-medium">{getOperatorLabel(operator, field?.type, t)}</span>
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

const JudgeModelSelector = ({
  resourceId,
  resourceType,
}: EvaluationProps) => {
  const { data: modelList } = useModelList(ModelTypeEnum.textGeneration)
  const resource = useEvaluationResource(resourceType, resourceId)
  const setJudgeModel = useEvaluationStore(state => state.setJudgeModel)
  const selectedModel = decodeModelSelection(resource.judgeModelId)

  useEffect(() => {
    if (resource.judgeModelId || !modelList.length)
      return

    const firstProvider = modelList[0]
    const firstModel = firstProvider.models[0]
    if (!firstProvider || !firstModel)
      return

    setJudgeModel(resourceType, resourceId, encodeModelSelection(firstProvider.provider, firstModel.model))
  }, [modelList, resource.judgeModelId, resourceId, resourceType, setJudgeModel])

  return (
    <ModelSelector
      defaultModel={selectedModel}
      modelList={modelList}
      onSelect={model => setJudgeModel(resourceType, resourceId, encodeModelSelection(model.provider, model.model))}
      showDeprecatedWarnIcon
      triggerClassName="h-11"
    />
  )
}

const MetricSelector = ({
  resourceType,
  resourceId,
}: EvaluationProps) => {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)
  const metricGroupLabels = {
    quality: t('metrics.groups.quality'),
    operations: t('metrics.groups.operations'),
  }
  const metrics = useEvaluationResource(resourceType, resourceId).metrics
  const addBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const addCustomMetric = useEvaluationStore(state => state.addCustomMetric)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const loadingTimerRef = useRef<number | null>(null)

  const triggerLoading = () => {
    if (loadingTimerRef.current)
      window.clearTimeout(loadingTimerRef.current)

    setIsLoading(true)
    loadingTimerRef.current = window.setTimeout(() => {
      setIsLoading(false)
    }, 180)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)

    if (nextOpen) {
      triggerLoading()
      return
    }

    if (loadingTimerRef.current)
      window.clearTimeout(loadingTimerRef.current)
    setIsLoading(false)
  }

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
    if (open)
      triggerLoading()
  }

  useEffect(() => {
    return () => {
      if (loadingTimerRef.current)
        window.clearTimeout(loadingTimerRef.current)
    }
  }, [])

  const filteredGroups = useMemo(() => {
    const filteredMetrics = config.builtinMetrics.filter((metric) => {
      const keyword = query.trim().toLowerCase()
      if (!keyword)
        return true

      return metric.label.toLowerCase().includes(keyword) || metric.description.toLowerCase().includes(keyword)
    })

    const grouped = filteredMetrics.reduce<Record<string, typeof filteredMetrics>>((acc, metric) => {
      acc[metric.group] = [...(acc[metric.group] ?? []), metric]
      return acc
    }, {})

    return Object.entries(grouped)
  }, [config.builtinMetrics, query])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="btn btn-medium btn-secondary inline-flex items-center">
        <RiAddLine className="mr-1 h-4 w-4" />
        {t('metrics.add')}
      </PopoverTrigger>
      <PopoverContent popupClassName="w-[360px] p-3">
        <div className="space-y-3">
          <Input
            value={query}
            showLeftIcon
            placeholder={t('metrics.searchPlaceholder')}
            onChange={handleQueryChange}
          />
          <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
            {isLoading && (
              <div className="space-y-2" data-testid="evaluation-metric-loading">
                {['metric-skeleton-1', 'metric-skeleton-2', 'metric-skeleton-3'].map(key => (
                  <div key={key} className="h-14 animate-pulse rounded-xl bg-background-default-subtle" />
                ))}
              </div>
            )}
            {!isLoading && filteredGroups.length === 0 && (
              <div className="rounded-xl border border-dashed border-divider-subtle px-4 py-8 text-center text-text-tertiary system-sm-regular">
                {t('metrics.noResults')}
              </div>
            )}
            {!isLoading && filteredGroups.map(([groupName, options]) => {
              const shownOptions = showAll ? options : options.slice(0, 2)
              return (
                <div key={groupName}>
                  <div className="mb-2 text-text-tertiary system-xs-medium-uppercase">{metricGroupLabels[groupName as keyof typeof metricGroupLabels] ?? groupName}</div>
                  <div className="space-y-2">
                    {shownOptions.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        className="w-full rounded-xl border border-divider-subtle px-3 py-3 text-left hover:border-components-button-secondary-border hover:bg-state-base-hover-alt"
                        onClick={() => {
                          addBuiltinMetric(resourceType, resourceId, option.id)
                          setOpen(false)
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-text-primary system-sm-semibold">{option.label}</div>
                            <div className="mt-1 text-text-tertiary system-xs-regular">{option.description}</div>
                          </div>
                          {metrics.some(metric => metric.optionId === option.id && metric.kind === 'builtin') && (
                            <Badge className="badge-accent">{t('metrics.added')}</Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {filteredGroups.some(([, options]) => options.length > 2) && (
            <button
              type="button"
              className="flex items-center text-text-accent system-sm-medium"
              onClick={() => setShowAll(value => !value)}
            >
              {showAll ? t('metrics.showLess') : t('metrics.showMore')}
              <RiArrowDownSLine className={cn('ml-1 h-4 w-4 transition-transform', showAll && 'rotate-180')} />
            </button>
          )}
          <div className="border-t border-divider-subtle pt-3">
            <Button
              className="w-full justify-center"
              variant="ghost-accent"
              onClick={() => {
                addCustomMetric(resourceType, resourceId)
                setOpen(false)
              }}
            >
              {t('metrics.addCustom')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const CustomMetricEditor = ({
  resourceType,
  resourceId,
  metric,
}: EvaluationProps & { metric: EvaluationMetric }) => {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)
  const setCustomMetricWorkflow = useEvaluationStore(state => state.setCustomMetricWorkflow)
  const addCustomMetricMapping = useEvaluationStore(state => state.addCustomMetricMapping)
  const updateCustomMetricMapping = useEvaluationStore(state => state.updateCustomMetricMapping)
  const removeCustomMetricMapping = useEvaluationStore(state => state.removeCustomMetricMapping)
  const selectedWorkflow = config.workflowOptions.find(option => option.id === metric.customConfig?.workflowId)
  const isConfigured = isCustomMetricConfigured(metric)

  if (!metric.customConfig)
    return null

  return (
    <div className="mt-4 rounded-xl border border-divider-subtle bg-background-default-subtle p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-text-primary system-sm-semibold">{t('metrics.custom.title')}</div>
          <div className="mt-1 text-text-tertiary system-xs-regular">{t('metrics.custom.description')}</div>
        </div>
        {!isConfigured && <Badge className="badge-warning">{t('metrics.custom.warningBadge')}</Badge>}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="mb-2 text-text-secondary system-xs-medium-uppercase">{t('metrics.custom.workflowLabel')}</div>
          <Select value={metric.customConfig.workflowId ?? ''} onValueChange={value => value && setCustomMetricWorkflow(resourceType, resourceId, metric.id, value)}>
            <SelectTrigger>
              <SelectValue placeholder={t('metrics.custom.workflowPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {config.workflowOptions.map(option => (
                <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedWorkflow && <div className="mt-2 text-text-tertiary system-xs-regular">{selectedWorkflow.description}</div>}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-text-secondary system-xs-medium-uppercase">{t('metrics.custom.mappingTitle')}</div>
            <Button size="small" variant="ghost" onClick={() => addCustomMetricMapping(resourceType, resourceId, metric.id)}>
              <RiAddLine className="mr-1 h-4 w-4" />
              {t('metrics.custom.addMapping')}
            </Button>
          </div>
          <div className="space-y-2">
            {metric.customConfig.mappings.map(mapping => (
              <MappingRow
                key={mapping.id}
                resourceType={resourceType}
                mapping={mapping}
                targetOptions={selectedWorkflow?.targetVariables ?? []}
                onUpdate={patch => updateCustomMetricMapping(resourceType, resourceId, metric.id, mapping.id, patch)}
                onRemove={() => removeCustomMetricMapping(resourceType, resourceId, metric.id, mapping.id)}
              />
            ))}
          </div>
          {!isConfigured && (
            <div className="mt-3 rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-2 text-text-tertiary system-xs-regular">
              {t('metrics.custom.mappingWarning')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MappingRow({
  resourceType,
  mapping,
  targetOptions,
  onUpdate,
  onRemove,
}: {
  resourceType: EvaluationResourceType
  mapping: CustomMetricMapping
  targetOptions: Array<{ id: string, label: string }>
  onUpdate: (patch: { sourceFieldId?: string | null, targetVariableId?: string | null }) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)

  return (
    <div className="grid gap-2 rounded-xl border border-divider-subtle bg-components-card-bg p-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
      <Select value={mapping.sourceFieldId ?? ''} onValueChange={value => onUpdate({ sourceFieldId: value })}>
        <SelectTrigger>
          <SelectValue placeholder={t('metrics.custom.sourcePlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {groupFieldOptions(config.fieldOptions).map(([groupName, fields]) => (
            <SelectGroup key={groupName}>
              <SelectGroupLabel>{groupName}</SelectGroupLabel>
              {fields.map(field => (
                <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-center text-text-quaternary">
        <RiArrowDownSLine className="h-4 w-4 -rotate-90" />
      </div>
      <Select value={mapping.targetVariableId ?? ''} onValueChange={value => onUpdate({ targetVariableId: value })}>
        <SelectTrigger>
          <SelectValue placeholder={t('metrics.custom.targetPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {targetOptions.map(option => (
            <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="small" aria-label={t('metrics.remove')} onClick={onRemove}>
        <RiDeleteBinLine className="h-4 w-4" />
      </Button>
    </div>
  )
}

const ConditionGroup = ({
  resourceType,
  resourceId,
  group,
  index,
}: EvaluationProps & { group: JudgmentConditionGroup, index: number }) => {
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
            <RiAddLine className="mr-1 h-4 w-4" />
            {t('conditions.addCondition')}
          </Button>
          <Button
            size="small"
            variant="ghost"
            aria-label={t('conditions.removeGroup')}
            onClick={() => removeConditionGroup(resourceType, resourceId, group.id)}
          >
            <RiDeleteBinLine className="h-4 w-4" />
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
              <div className="pl-1 pt-1">
                <Button
                  size="small"
                  variant="ghost"
                  aria-label={t('conditions.removeCondition')}
                  onClick={() => removeConditionItem(resourceType, resourceId, group.id, item.id)}
                >
                  <RiCloseLine className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const BatchTestPanel = ({
  resourceType,
  resourceId,
}: EvaluationProps) => {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)
  const tabLabels = {
    'input-fields': t('batch.tabs.input-fields'),
    'history': t('batch.tabs.history'),
  }
  const statusLabels = {
    running: t('batch.status.running'),
    success: t('batch.status.success'),
    failed: t('batch.status.failed'),
  }
  const resource = useEvaluationResource(resourceType, resourceId)
  const setBatchTab = useEvaluationStore(state => state.setBatchTab)
  const setUploadedFileName = useEvaluationStore(state => state.setUploadedFileName)
  const runBatchTest = useEvaluationStore(state => state.runBatchTest)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isRunnable = isEvaluationRunnable(resource)

  const handleDownloadTemplate = () => {
    const content = ['case_id,input,expected', '1,Example input,Example output'].join('\n')
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`
    link.download = config.templateFileName
    link.click()
  }

  const handleRun = () => {
    if (!isRunnable) {
      Toast.notify({
        type: 'warning',
        message: t('batch.validation'),
      })
      return
    }

    runBatchTest(resourceType, resourceId)
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-divider-subtle bg-components-card-bg">
      <div className="border-b border-divider-subtle p-5">
        <div className="flex items-center gap-2 text-text-primary system-md-semibold">
          <RiFlaskLine className="h-5 w-5" />
          {t('batch.title')}
        </div>
        <div className="mt-2 rounded-xl border border-divider-subtle bg-background-default-subtle p-3">
          <div className="text-text-primary system-sm-semibold">{t('batch.noticeTitle')}</div>
          <div className="mt-1 text-text-tertiary system-xs-regular">{t('batch.noticeDescription')}</div>
        </div>
        <div className="mt-4 flex rounded-xl border border-divider-subtle bg-background-default-subtle p-1">
          {(['input-fields', 'history'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              className={cn(
                TAB_CLASS_NAME,
                resource.activeBatchTab === tab ? 'bg-components-card-bg text-text-primary shadow-xs' : 'text-text-tertiary',
              )}
              onClick={() => setBatchTab(resourceType, resourceId, tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {resource.activeBatchTab === 'input-fields' && (
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-text-secondary system-xs-medium-uppercase">{t('batch.requirementsTitle')}</div>
              <div className="space-y-2">
                {config.batchRequirements.map(requirement => (
                  <div key={requirement} className="flex gap-2 text-text-tertiary system-sm-regular">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-text-quaternary" />
                    <span>{requirement}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Button variant="secondary" className="w-full justify-center" onClick={handleDownloadTemplate}>
                <RiDownloadLine className="mr-1 h-4 w-4" />
                {t('batch.downloadTemplate')}
              </Button>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  setUploadedFileName(resourceType, resourceId, file?.name ?? null)
                }}
              />
              <button
                type="button"
                className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-divider-subtle bg-background-default-subtle px-4 py-6 text-center hover:border-components-button-secondary-border"
                onClick={() => fileInputRef.current?.click()}
              >
                <RiFileUploadLine className="h-5 w-5 text-text-tertiary" />
                <div className="mt-2 text-text-primary system-sm-semibold">{t('batch.uploadTitle')}</div>
                <div className="mt-1 text-text-tertiary system-xs-regular">{resource.uploadedFileName ?? t('batch.uploadHint')}</div>
              </button>
            </div>
            {!isRunnable && (
              <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-2 text-text-tertiary system-xs-regular">
                {t('batch.validation')}
              </div>
            )}
            <Button className="w-full justify-center" variant="primary" disabled={!isRunnable} onClick={handleRun}>
              {t('batch.run')}
            </Button>
          </div>
        )}
        {resource.activeBatchTab === 'history' && (
          <div className="space-y-3">
            {resource.batchRecords.length === 0 && (
              <div className="rounded-2xl border border-dashed border-divider-subtle px-4 py-10 text-center text-text-tertiary system-sm-regular">
                {t('batch.emptyHistory')}
              </div>
            )}
            {resource.batchRecords.map(record => (
              <div key={record.id} className="rounded-2xl border border-divider-subtle bg-background-default-subtle p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-text-primary system-sm-semibold">{record.summary}</div>
                    <div className="mt-1 text-text-tertiary system-xs-regular">{record.fileName}</div>
                  </div>
                  <Badge className={record.status === 'failed' ? 'badge-warning' : record.status === 'success' ? 'badge-accent' : ''}>
                    {record.status === 'running'
                      ? (
                          <span className="flex items-center gap-1">
                            <RiLoader4Line className="h-3 w-3 animate-spin" />
                            {statusLabels.running}
                          </span>
                        )
                      : statusLabels[record.status]}
                  </Badge>
                </div>
                <div className="mt-3 text-text-tertiary system-xs-regular">{record.startedAt}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const Evaluation = ({
  resourceType,
  resourceId,
}: EvaluationProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const ensureResource = useEvaluationStore(state => state.ensureResource)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const addConditionGroup = useEvaluationStore(state => state.addConditionGroup)

  useEffect(() => {
    ensureResource(resourceType, resourceId)
  }, [ensureResource, resourceId, resourceType])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background-body xl:flex-row">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 xl:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <SectionHeader title={t('title')} description={t('description')} />
          <section className="rounded-2xl border border-divider-subtle bg-components-card-bg p-5">
            <SectionHeader title={t('judgeModel.title')} description={t('judgeModel.description')} />
            <div className="mt-4 max-w-[360px]">
              <JudgeModelSelector resourceType={resourceType} resourceId={resourceId} />
            </div>
          </section>

          <section className="rounded-2xl border border-divider-subtle bg-components-card-bg p-5">
            <SectionHeader
              title={t('metrics.title')}
              description={t('metrics.description')}
              action={<MetricSelector resourceType={resourceType} resourceId={resourceId} />}
            />
            <div className="mt-4 space-y-3">
              {resource.metrics.map(metric => (
                <div key={metric.id} className="rounded-2xl border border-divider-subtle p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-text-primary system-sm-semibold">{metric.label}</div>
                      <div className="mt-1 text-text-tertiary system-xs-regular">{metric.description}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {metric.badges.map(badge => (
                          <Badge key={badge} className={badge === 'Workflow' ? 'badge-accent' : ''}>{badge}</Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="small"
                      variant="ghost"
                      aria-label={t('metrics.remove')}
                      onClick={() => removeMetric(resourceType, resourceId, metric.id)}
                    >
                      <RiDeleteBinLine className="h-4 w-4" />
                    </Button>
                  </div>
                  {metric.kind === 'custom-workflow' && (
                    <CustomMetricEditor
                      resourceType={resourceType}
                      resourceId={resourceId}
                      metric={metric}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-divider-subtle bg-components-card-bg p-5">
            <SectionHeader
              title={t('conditions.title')}
              description={t('conditions.description')}
              action={(
                <Button variant="secondary" onClick={() => addConditionGroup(resourceType, resourceId)}>
                  <RiAddLine className="mr-1 h-4 w-4" />
                  {t('conditions.addGroup')}
                </Button>
              )}
            />
            <div className="mt-4 space-y-4">
              {resource.conditions.length === 0 && (
                <div className="rounded-2xl border border-dashed border-divider-subtle px-4 py-10 text-center">
                  <div className="text-text-primary system-sm-semibold">{t('conditions.emptyTitle')}</div>
                  <div className="mt-1 text-text-tertiary system-sm-regular">{t('conditions.emptyDescription')}</div>
                </div>
              )}
              {resource.conditions.map((group, index) => (
                <ConditionGroup
                  key={group.id}
                  resourceType={resourceType}
                  resourceId={resourceId}
                  group={group}
                  index={index}
                />
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="h-[420px] shrink-0 xl:h-auto xl:w-[360px]">
        <BatchTestPanel resourceType={resourceType} resourceId={resourceId} />
      </div>
    </div>
  )
}

export default Evaluation
