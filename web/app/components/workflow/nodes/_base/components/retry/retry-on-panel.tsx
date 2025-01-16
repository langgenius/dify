import { useTranslation } from 'react-i18next'
import { useRetryConfig } from './hooks'
import s from './style.module.css'
import Switch from '@/app/components/base/switch'
import Slider from '@/app/components/base/slider'
import Input from '@/app/components/base/input'
import type {
  Node,
} from '@/app/components/workflow/types'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { MAX_RETRIES_DEFAULT, MAX_RETRIES_UPPER_BOUND_DEFAULT, RETRY_INTERVAL_DEFAULT, RETRY_INTERVAL_UPPER_BOUND_DEFAULT } from '@/config'

type RetryOnPanelProps = Pick<Node, 'id' | 'data'>
const RetryOnPanel = ({
  id,
  data,
}: RetryOnPanelProps) => {
  const { t } = useTranslation()
  const { handleRetryConfigChange } = useRetryConfig(id)
  const { retry_config } = data

  const handleRetryEnabledChange = (value: boolean) => {
    handleRetryConfigChange({
      retry_enabled: value,
      max_retries: retry_config?.max_retries || MAX_RETRIES_DEFAULT,
      retry_interval: retry_config?.retry_interval || RETRY_INTERVAL_DEFAULT,
      max_retries_upper_bound: retry_config?.max_retries_upper_bound || MAX_RETRIES_UPPER_BOUND_DEFAULT,
      retry_interval_upper_bound: retry_config?.retry_interval_upper_bound || RETRY_INTERVAL_UPPER_BOUND_DEFAULT,
    })
  }

  const handleMaxRetriesChange = (value: number) => {
    if (value > (retry_config?.max_retries_upper_bound || MAX_RETRIES_UPPER_BOUND_DEFAULT))
      value = (retry_config?.max_retries_upper_bound || MAX_RETRIES_UPPER_BOUND_DEFAULT)
    else if (value < 1)
      value = 1
    handleRetryConfigChange({
      retry_enabled: true,
      max_retries: value,
      retry_interval: retry_config?.retry_interval || RETRY_INTERVAL_DEFAULT,
      max_retries_upper_bound: retry_config?.max_retries_upper_bound || MAX_RETRIES_UPPER_BOUND_DEFAULT,
      retry_interval_upper_bound: retry_config?.retry_interval_upper_bound || RETRY_INTERVAL_UPPER_BOUND_DEFAULT,
    })
  }

  const handleRetryIntervalChange = (value: number) => {
    // リトライインターバルの制限をデフォルト値に基づき変更
    if (value > (retry_config?.retry_interval_upper_bound || RETRY_INTERVAL_UPPER_BOUND_DEFAULT))
      value = (retry_config?.retry_interval_upper_bound || RETRY_INTERVAL_UPPER_BOUND_DEFAULT)
    else if (value < 100)
      value = 100
    handleRetryConfigChange({
      retry_enabled: true,
      max_retries: retry_config?.max_retries || MAX_RETRIES_DEFAULT,
      retry_interval: value,
      max_retries_upper_bound: retry_config?.max_retries_upper_bound || MAX_RETRIES_UPPER_BOUND_DEFAULT,
      retry_interval_upper_bound: retry_config?.retry_interval_upper_bound || RETRY_INTERVAL_UPPER_BOUND_DEFAULT,
    })
  }

  return (
    <>
      <div className='pt-2'>
        <div className='flex items-center justify-between px-4 py-2 h-10'>
          <div className='flex items-center'>
            <div className='mr-0.5 system-sm-semibold-uppercase text-text-secondary'>{t('workflow.nodes.common.retry.retryOnFailure')}</div>
          </div>
          <Switch
            defaultValue={retry_config?.retry_enabled ?? false}
            onChange={v => handleRetryEnabledChange(v)}
          />
        </div>
        {
          retry_config?.retry_enabled && (
            <div className='px-4 pb-2'>
              <div className='flex items-center mb-1 w-full'>
                <div className='grow mr-2 system-xs-medium-uppercase'>{t('workflow.nodes.common.retry.maxRetries')}</div>
                <Slider
                  className='mr-3 w-[108px]'
                  value={retry_config?.max_retries || MAX_RETRIES_DEFAULT}
                  onChange={handleMaxRetriesChange}
                  min={1}
                  max={retry_config?.max_retries_upper_bound || MAX_RETRIES_UPPER_BOUND_DEFAULT}
                />
                <Input
                  type='number'
                  wrapperClassName='w-[80px]'
                  value={retry_config?.max_retries || MAX_RETRIES_DEFAULT}
                  onChange={e => handleMaxRetriesChange(e.target.value as any)}
                  min={1}
                  max={retry_config?.max_retries_upper_bound || MAX_RETRIES_UPPER_BOUND_DEFAULT}
                  unit={t('workflow.nodes.common.retry.times') || ''}
                  className={s.input}
                />
              </div>
              <div className='flex items-center'>
                <div className='grow mr-2 system-xs-medium-uppercase'>{t('workflow.nodes.common.retry.retryInterval')}</div>
                <Slider
                  className='mr-3 w-[108px]'
                  value={retry_config?.retry_interval || RETRY_INTERVAL_DEFAULT}
                  onChange={handleRetryIntervalChange}
                  min={100}
                  max={retry_config?.retry_interval_upper_bound || RETRY_INTERVAL_UPPER_BOUND_DEFAULT}
                />
                <Input
                  type='number'
                  wrapperClassName='w-[80px]'
                  value={retry_config?.retry_interval || RETRY_INTERVAL_DEFAULT}
                  onChange={e => handleRetryIntervalChange(e.target.value as any)}
                  min={100}
                  max={retry_config?.retry_interval_upper_bound || RETRY_INTERVAL_UPPER_BOUND_DEFAULT}
                  unit={t('workflow.nodes.common.retry.ms') || ''}
                  className={s.input}
                />
              </div>
            </div>
          )
        }
      </div>
      <Split className='mx-4 mt-2' />
    </>
  )
}

export default RetryOnPanel
