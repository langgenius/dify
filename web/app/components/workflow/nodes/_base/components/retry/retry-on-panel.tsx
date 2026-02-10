import type {
  Node,
} from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Slider from '@/app/components/base/slider'
import Switch from '@/app/components/base/switch'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import { useRetryConfig } from './hooks'
import s from './style.module.css'

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

  return (
    <>
      <div className="pt-2">
        <div className="flex h-10 items-center justify-between px-4 py-2">
          <div className="flex items-center">
            <div className="system-sm-semibold-uppercase mr-0.5 text-text-secondary">{t('nodes.common.retry.retryOnFailure', { ns: 'workflow' })}</div>
          </div>
          <Switch
            defaultValue={retry_config?.retry_enabled}
            onChange={v => handleRetryEnabledChange(v)}
          />
        </div>
        {
          retry_config?.retry_enabled && (
            <div className="px-4 pb-2">
              <div className="mb-1 flex w-full items-center">
                <div className="system-xs-medium-uppercase mr-2 grow text-text-secondary">{t('nodes.common.retry.maxRetries', { ns: 'workflow' })}</div>
                <Slider
                  className="mr-3 w-[108px]"
                  value={retry_config?.max_retries || 3}
                  onChange={handleMaxRetriesChange}
                  min={1}
                  max={10}
                />
                <Input
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
              </div>
              <div className="flex items-center">
                <div className="system-xs-medium-uppercase mr-2 grow text-text-secondary">{t('nodes.common.retry.retryInterval', { ns: 'workflow' })}</div>
                <Slider
                  className="mr-3 w-[108px]"
                  value={retry_config?.retry_interval || 1000}
                  onChange={handleRetryIntervalChange}
                  min={100}
                  max={5000}
                />
                <Input
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
