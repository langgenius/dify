import Tooltip from '@/app/components/base/tooltip'
import { RiErrorWarningFill } from '@remixicon/react'

type StatusIndicatorsProps = {
  needsConfiguration: boolean
  modelProvider: boolean
  disabled: boolean
  pluginInfo: any
  t: any
}

const StatusIndicators = ({ needsConfiguration, modelProvider, disabled, pluginInfo, t }: StatusIndicatorsProps) => {
  return (
    <>
      {!needsConfiguration && modelProvider && disabled && (
        <Tooltip
          popupContent={t('workflow.nodes.agent.modelSelectorTooltips.deprecated')}
          asChild={false}
        >
          <RiErrorWarningFill className='w-4 h-4 text-text-destructive' />
        </Tooltip>
      )}
      {!modelProvider && !pluginInfo && (
        <Tooltip
          popupContent={
            <div className='flex w-[240px] max-w-[240px] gap-1 flex-col px-1 py-1.5'>
              <div className='text-text-primary title-xs-semi-bold'>{t('workflow.nodes.agent.modelNotInMarketplace.title')}</div>
              <div className='min-w-[200px] text-text-secondary body-xs-regular'>
                {t('workflow.nodes.agent.modelNotInMarketplace.desc')}
              </div>
              <div className='text-text-accent body-xs-regular'>{t('workflow.nodes.agent.modelNotInMarketplace.manageInPlugins')}</div>
            </div>
          }
          asChild={false}
          needsDelay
        >
          <RiErrorWarningFill className='w-4 h-4 text-text-destructive' />
        </Tooltip>
      )}
    </>
  )
}

export default StatusIndicators
