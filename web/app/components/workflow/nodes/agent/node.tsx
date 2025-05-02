import { type FC, memo, useMemo } from 'react'
import type { NodeProps } from '../../types'
import type { AgentNodeType } from './types'
import { SettingItem } from '../_base/components/setting-item'
import { Group, GroupLabel } from '../_base/components/group'
import type { ToolIconProps } from './components/tool-icon'
import { ToolIcon } from './components/tool-icon'
import useConfig from './use-config'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { ModelBar } from './components/model-bar'

const AgentNode: FC<NodeProps<AgentNodeType>> = (props) => {
  const { inputs, currentStrategy, currentStrategyStatus, pluginDetail } = useConfig(props.id, props.data)
  const renderI18nObject = useRenderI18nObject()
  const { t } = useTranslation()
  const models = useMemo(() => {
    if (!inputs) return []
    // if selected, show in node
    // if required and not selected, show empty selector
    // if not required and not selected, show nothing
    const models = currentStrategy?.parameters
      .filter(param => param.type === FormTypeEnum.modelSelector)
      .reduce((acc, param) => {
        const item = inputs.agent_parameters?.[param.name]?.value
        if (!item) {
          if (param.required) {
            acc.push({ param: param.name })
            return acc
          }
          else { return acc }
        }
        acc.push({ provider: item.provider, model: item.model, param: param.name })
        return acc
      }, [] as Array<{ param: string } | { provider: string, model: string, param: string }>) || []
    return models
  }, [currentStrategy, inputs])

  const tools = useMemo(() => {
    const tools: Array<ToolIconProps> = []
    currentStrategy?.parameters.forEach((param) => {
      if (param.type === FormTypeEnum.toolSelector) {
        const field = param.name
        const value = inputs.agent_parameters?.[field]?.value
        if (value) {
          tools.push({
            providerName: value.provider_name as any,
          })
        }
      }
      if (param.type === FormTypeEnum.multiToolSelector) {
        const field = param.name
        const value = inputs.agent_parameters?.[field]?.value
        if (value) {
          (value as unknown as any[]).forEach((item) => {
            tools.push({
              providerName: item.provider_name,
            })
          })
        }
      }
    })
    return tools
  }, [currentStrategy?.parameters, inputs.agent_parameters])
  return <div className='mb-1 px-3 py-1 space-y-1'>
    {inputs.agent_strategy_name
      ? <SettingItem
        label={t('workflow.nodes.agent.strategy.shortLabel')}
        status={
          currentStrategyStatus && !currentStrategyStatus.isExistInPlugin
            ? 'error'
            : undefined
        }
        tooltip={
          (currentStrategyStatus && !currentStrategyStatus.isExistInPlugin)
            ? t('workflow.nodes.agent.strategyNotInstallTooltip', {
              plugin: pluginDetail?.declaration.label
                ? renderI18nObject(pluginDetail?.declaration.label)
                : undefined,
              strategy: inputs.agent_strategy_label,
            })
            : undefined
        }
      >
        {inputs.agent_strategy_label}
      </SettingItem>
      : <SettingItem label={t('workflow.nodes.agent.strategyNotSet')} />}
    {models.length > 0 && <Group
      label={<GroupLabel className='mt-1'>
        {t('workflow.nodes.agent.model')}
      </GroupLabel>}
    >
      {models.map((model) => {
        return <ModelBar
          {...model}
          key={model.param}
        />
      })}
    </Group>}
    {tools.length > 0 && <Group label={<GroupLabel className='mt-1'>
      {t('workflow.nodes.agent.toolbox')}
    </GroupLabel>}>
      <div className='grid grid-cols-10 gap-0.5'>
        {tools.map(tool => <ToolIcon {...tool} key={Math.random()} />)}
      </div>
    </Group>}
  </div>
}

AgentNode.displayName = 'AgentNode'

export default memo(AgentNode)
