import NodeStatus, { NodeStatusEnum } from '@/app/components/base/node-status'
import type { NodeProps } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginTriggerNodeType } from './types'
import useConfig from './use-config'

const formatConfigValue = (rawValue: any): string => {
  if (rawValue === null || rawValue === undefined)
    return ''

  if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean')
    return String(rawValue)

  if (Array.isArray(rawValue))
    return rawValue.join('.')

  if (typeof rawValue === 'object') {
    const { value } = rawValue as { value?: any }
    if (value === null || value === undefined)
      return ''
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      return String(value)
    if (Array.isArray(value))
      return value.join('.')
    try {
      return JSON.stringify(value)
    }
    catch {
      return ''
    }
  }

  return ''
}

const Node: FC<NodeProps<PluginTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { subscriptions } = useConfig(id, data)
  const { config = {}, subscription_id } = data
  const configKeys = Object.keys(config)

  const { t } = useTranslation()

  const isValidSubscription = useMemo(() => {
    return subscription_id && subscriptions?.some(sub => sub.id === subscription_id)
  }, [subscription_id, subscriptions])

  return (
    <div className="mb-1 px-3 py-1">
      <div className="space-y-0.5">
        {!isValidSubscription && <NodeStatus status={NodeStatusEnum.warning} message={t('pluginTrigger.node.status.warning')} />}
        {isValidSubscription && configKeys.map((key, index) => (
          <div
            key={index}
            className="flex h-6 items-center justify-between space-x-1 rounded-md bg-workflow-block-parma-bg px-1 text-xs font-normal text-text-secondary"
          >
            <div
              title={key}
              className="max-w-[100px] shrink-0 truncate text-xs font-medium uppercase text-text-tertiary"
            >
              {key}
            </div>
            <div
              title={formatConfigValue(config[key])}
              className="w-0 shrink-0 grow truncate text-right text-xs font-normal text-text-secondary"
            >
              {(() => {
                const displayValue = formatConfigValue(config[key])
                if (displayValue.includes('secret'))
                  return '********'
                return displayValue
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(Node)
