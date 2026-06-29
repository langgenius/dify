import type {
  RetryCondition,
  RetryConditionOperator,
} from './types'
import type {
  Node,
} from '@/app/components/workflow/types'
import { FieldsetLegend, FieldsetRoot } from '@langgenius/dify-ui/fieldset'
import { Slider } from '@langgenius/dify-ui/slider'
import { Switch } from '@langgenius/dify-ui/switch'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { useRetryConfig } from './hooks'
import { RetryConditionOperator as OperatorEnum } from './types'
import s from './style.module.css'

const OPERATOR_OPTIONS: { value: RetryConditionOperator; labelKey: string }[] = [
  { value: OperatorEnum.contains, labelKey: 'nodes.common.retry.condition.contains' },
  { value: OperatorEnum.notContains, labelKey: 'nodes.common.retry.condition.notContains' },
  { value: OperatorEnum.startsWith, labelKey: 'nodes.common.retry.condition.startsWith' },
  { value: OperatorEnum.endsWith, labelKey: 'nodes.common.retry.condition.endsWith' },
  { value: OperatorEnum.equals, labelKey: 'nodes.common.retry.condition.equals' },
  { value: OperatorEnum.notEquals, labelKey: 'nodes.common.retry.condition.notEquals' },
  { value: OperatorEnum.regex, labelKey: 'nodes.common.retry.condition.regex' },
]

type RetryOnPanelProps = Pick<Node, 'id' | 'data'>
const RetryOnPanel = ({
  id,
  data,
}: RetryOnPanelProps) => {
  const { t } = useTranslation()
  const { handleRetryConfigChange, handleRetryConditionChange } = useRetryConfig(id)
  const { retry_config, retry_condition } = data
  const maxRetriesLabel = t('nodes.common.retry.maxRetries', { ns: 'workflow' })
  const retryIntervalLabel = t('nodes.common.retry.retryInterval', { ns: 'workflow' })

  const handleRetryEnabledChange = (value: boolean) => {
    handleRetryConfigChange({
      retry_enabled: value,
      max_retries: retry_config?.max_retries || 3,
      retry_interval: retry_config?.retry_interval || 1000,
    })
  }

  const handleMaxRetriesChange = (value: number) => {
    if (value > 10)
      value = 10
    else if (value < 1)
      value = 1
    handleRetryConfigChange({
      retry_enabled: true,
      max_retries: value,
      retry_interval: retry_config?.retry_interval || 1000,
    })
  }

  const handleRetryIntervalChange = (value: number) => {
    if (value > 5000)
      value = 5000
    else if (value < 100)
      value = 100
    handleRetryConfigChange({
      retry_enabled: true,
      max_retries: retry_config?.max_retries || 3,
      retry_interval: value,
    })
  }

  const handleConditionEnabledChange = useCallback((enabled: boolean) => {
    const condition: RetryCondition = {
      enabled,
      error_filter: retry_condition?.error_filter || {
        operator: OperatorEnum.contains,
        value: '',
      },
    }
    handleRetryConditionChange(condition)
  }, [handleRetryConditionChange, retry_condition])

  const handleConditionOperatorChange = useCallback((operator: RetryConditionOperator) => {
    const condition: RetryCondition = {
      enabled: retry_condition?.enabled ?? true,
      error_filter: {
        operator,
        value: retry_condition?.error_filter?.value || '',
      },
    }
    handleRetryConditionChange(condition)
  }, [handleRetryConditionChange, retry_condition])

  const handleConditionValueChange = useCallback((value: string) => {
    const condition: RetryCondition = {
      enabled: retry_condition?.enabled ?? true,
      error_filter: {
        operator: retry_condition?.error_filter?.operator || OperatorEnum.contains,
        value,
      },
    }
    handleRetryConditionChange(condition)
  }, [handleRetryConditionChange, retry_condition])

  return (
    <>
      <div className="pt-2">
        <div className="flex h-10 items-center justify-between px-4 py-2">
          <div className="flex items-center">
            <div className="mr-0.5 system-sm-semibold-uppercase text-text-secondary">{t('nodes.common.retry.retryOnFailure', { ns: 'workflow' })}</div>
          </div>
          <Switch
            checked={retry_config?.retry_enabled ?? false}
            onCheckedChange={v => handleRetryEnabledChange(v)}
          />
        </div>
        {
          retry_config?.retry_enabled && (
            <div className="px-4 pb-2">
              <FieldsetRoot className="mb-1 flex w-full items-center">
                <FieldsetLegend className="sr-only">{maxRetriesLabel}</FieldsetLegend>
                <div className="mr-2 grow system-xs-medium-uppercase text-text-secondary">{maxRetriesLabel}</div>
                <Slider
                  className="mr-3 w-[108px]"
                  value={retry_config?.max_retries || 3}
                  onValueChange={handleMaxRetriesChange}
                  min={1}
                  max={10}
                  aria-label={maxRetriesLabel}
                />
                <Input
                  aria-label={maxRetriesLabel}
                  type="number"
                  wrapperClassName="w-[100px]"
                  value={retry_config?.max_retries || 3}
                  onChange={e =>
                    handleMaxRetriesChange(Number.parseInt(e.currentTarget.value, 10) || 3)}
                  min={1}
                  max={10}
                  unit={t('nodes.common.retry.times', { ns: 'workflow' }) || ''}
                  className={s.input}
                />
              </FieldsetRoot>
              <FieldsetRoot className="flex items-center">
                <FieldsetLegend className="sr-only">{retryIntervalLabel}</FieldsetLegend>
                <div className="mr-2 grow system-xs-medium-uppercase text-text-secondary">{retryIntervalLabel}</div>
                <Slider
                  className="mr-3 w-[108px]"
                  value={retry_config?.retry_interval || 1000}
                  onValueChange={handleRetryIntervalChange}
                  min={100}
                  max={5000}
                  aria-label={retryIntervalLabel}
                />
                <Input
                  aria-label={retryIntervalLabel}
                  type="number"
                  wrapperClassName="w-[100px]"
                  value={retry_config?.retry_interval || 1000}
                  onChange={e =>
                    handleRetryIntervalChange(Number.parseInt(e.currentTarget.value, 10) || 1000)}
                  min={100}
                  max={5000}
                  unit={t('nodes.common.retry.ms', { ns: 'workflow' }) || ''}
                  className={s.input}
                />
              </FieldsetRoot>
              {/* Conditional Retry */}
              <div className="mt-3 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="system-xs-medium-uppercase text-text-secondary">
                    {t('nodes.common.retry.condition.title', { ns: 'workflow' })}
                  </div>
                  <Switch
                    size="sm"
                    checked={retry_condition?.enabled ?? false}
                    onCheckedChange={handleConditionEnabledChange}
                  />
                </div>
                {retry_condition?.enabled && (
                  <div className="space-y-2">
                    <div className="system-xs-regular text-text-tertiary">
                      {t('nodes.common.retry.condition.description', { ns: 'workflow' })}
                    </div>
                    <select
                      className="w-full rounded-md border border-components-input-border bg-components-input-bg-normal px-2 py-1.5 text-[13px] text-text-secondary outline-none"
                      value={retry_condition?.error_filter?.operator || OperatorEnum.contains}
                      onChange={e => handleConditionOperatorChange(e.target.value as RetryConditionOperator)}
                      aria-label={t('nodes.common.retry.condition.operator', { ns: 'workflow' })}
                    >
                      {OPERATOR_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey, { ns: 'workflow' })}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={t('nodes.common.retry.condition.errorPattern', { ns: 'workflow' })}
                      placeholder={t('nodes.common.retry.condition.errorPatternPlaceholder', { ns: 'workflow' }) || ''}
                      value={retry_condition?.error_filter?.value || ''}
                      onChange={e => handleConditionValueChange(e.currentTarget.value)}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        }
      </div>
      <Split className="mx-4 mt-2" />
    </>
  )
}

export default RetryOnPanel
