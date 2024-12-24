import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { useState } from 'react'
import AllTools from '../../../block-selector/all-tools'
import type { Strategy } from './agent-strategy'
import classNames from '@/utils/classnames'
import { RiArrowDownSLine, RiErrorWarningFill } from '@remixicon/react'
import { useAllBuiltInTools } from '@/service/use-tools'
import Tooltip from '@/app/components/base/tooltip'
import Link from 'next/link'
import { InstallPluginButton } from './install-plugin-button'

const ExternalNotInstallWarn = () => {
  // TODO: add i18n label
  return <Tooltip
    popupContent={<div className='space-y-1 text-xs'>
      <h3 className='text-text-primary font-semibold'>This plugin is not installed</h3>
      <p className='text-text-secondary tracking-tight'>This plugin is installed from GitHub. Please go to Plugins to reinstall</p>
      <p>
        <Link href={'/plugins'} className='text-text-accent tracking-tight'>Link to Plugins</Link>
      </p>
    </div>}
    needsDelay
  >
    <div>
      <RiErrorWarningFill className='text-text-destructive size-4' />
    </div>
  </Tooltip>
}

export type AgentStrategySelectorProps = {
  value?: Strategy,
  onChange: (value?: Strategy) => void,
}

export const AgentStrategySelector = (props: AgentStrategySelectorProps) => {
  const { value, onChange } = props
  const [open, setOpen] = useState(false)
  const list = useAllBuiltInTools()
  // TODO: should be replaced by real data
  const isExternalInstalled = true
  return <PortalToFollowElem open={open} onOpenChange={setOpen}>
    <PortalToFollowElemTrigger className='w-full'>
      <div className='py-2 pl-3 pr-2 flex items-center rounded-lg bg-components-input-bg-normal w-full hover:bg-state-base-hover-alt' onClick={() => setOpen(true)}>
        {list.data && <img
          src={list.data.find(
            coll => coll,
          )?.icon as string}
          width={24}
          height={24}
          className='rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'
          alt='icon'
        />}
        <p
          className={classNames(value ? 'text-components-input-text-filled' : 'text-components-input-text-placeholder', 'text-xs px-1')}
        >
          {value?.agent_strategy_name || 'Select agentic strategy'}
        </p>
        <div className='ml-auto flex items-center gap-1'>
          <InstallPluginButton onClick={e => e.preventDefault()} />
          {isExternalInstalled ? <ExternalNotInstallWarn /> : <RiArrowDownSLine className='size-4 text-text-tertiary' />}
        </div>
      </div>
    </PortalToFollowElemTrigger>
    <PortalToFollowElemContent>
      {list.data && <AllTools
        className='border-components-panel-border bg-components-panel-bg-blur'
        searchText=''
        tags={[]}
        buildInTools={list.data}
        customTools={[]}
        workflowTools={[]}
        onSelect={(_e, tool) => {
          if (!tool) {
          // TODO: should not be called, try it
            return
          }
          onChange({
            agent_strategy_name: tool.title,
            agent_strategy_provider_name: tool.provider_name,
            agent_parameters: {},
          })
        }}
      />}
    </PortalToFollowElemContent>
  </PortalToFollowElem>
}
