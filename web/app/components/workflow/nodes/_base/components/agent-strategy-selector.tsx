import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { useMemo, useState } from 'react'
import type { Strategy } from './agent-strategy'
import classNames from '@/utils/classnames'
import { RiArrowDownSLine, RiArrowRightUpLine, RiErrorWarningFill } from '@remixicon/react'
import { useAllBuiltInTools } from '@/service/use-tools'
import Tooltip from '@/app/components/base/tooltip'
import Link from 'next/link'
import { InstallPluginButton } from './install-plugin-button'
import ViewTypeSelect, { ViewType } from '../../../block-selector/view-type-select'
import SearchInput from '@/app/components/base/search-input'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import Tools from '../../../block-selector/tools'

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
  const [viewType, setViewType] = useState<ViewType>(ViewType.flat)
  const [query, setQuery] = useState('')
  const filteredTools = useMemo(() => {
    if (!list.data) return []
    return list.data.filter(tool => tool.name.toLowerCase().includes(query.toLowerCase()))
  }, [query, list.data])
  // TODO: should be replaced by real data
  const isExternalInstalled = true
  return <PortalToFollowElem open={open} onOpenChange={setOpen} placement='bottom'>
    <PortalToFollowElemTrigger className='w-full'>
      <div className='py-2 pl-3 pr-2 flex items-center rounded-lg bg-components-input-bg-normal w-full hover:bg-state-base-hover-alt select-none' onClick={() => setOpen(o => !o)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {list.data && value && <img
          src={list.data.find(
            coll => coll,
          )?.icon as string}
          width={20}
          height={20}
          className='rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge'
          alt='icon'
        />}
        <p
          className={classNames(value ? 'text-components-input-text-filled' : 'text-components-input-text-placeholder', 'text-xs px-1')}
        >
          {value?.agent_strategy_name || 'Select agentic strategy'}
        </p>
        {value && <div className='ml-auto flex items-center gap-1'>
          <InstallPluginButton onClick={e => e.stopPropagation()} size={'small'} />
          {isExternalInstalled ? <ExternalNotInstallWarn /> : <RiArrowDownSLine className='size-4 text-text-tertiary' />}
        </div>}
      </div>
    </PortalToFollowElemTrigger>
    <PortalToFollowElemContent className='z-10'>
      <div className='bg-components-panel-bg-blur border-components-panel-border border-[0.5px] rounded-md shadow overflow-hidden w-[388px]'>
        <header className='p-2 gap-1 flex'>
          <SearchInput placeholder='Search agentic strategy' value={query} onChange={setQuery} className={'w-full'} />
          <ViewTypeSelect viewType={viewType} onChange={setViewType} />
        </header>
        <main className="md:h-[300px] xl:h-[400px] 2xl:h-[564px] relative overflow-hidden">
          <Tools
            tools={filteredTools}
            viewType={viewType}
            onSelect={(_, tool) => {
              onChange({
                agent_strategy_name: tool!.title,
                agent_strategy_provider_name: tool!.provider_name,
                agent_parameters: tool!.params,
              })
              setOpen(false)
            }}
            hasSearchText={false}
            showWorkflowEmpty
            className='max-w-none'
            indexBarClassName='top-0 xl:top-36'
          />
          <div className='absolute bottom-0 px-4 py-2 flex items-center justify-center border-t border-divider-subtle text-text-accent-light-mode-only bg-components-panel-bg text-xs'>
            Find more in
            <Link href={MARKETPLACE_URL_PREFIX} className='flex ml-1'>
              Marketplace <RiArrowRightUpLine className='size-3' />
            </Link>
          </div>
        </main>
      </div>
      {/* <div>
        aaa
      </div> */}
    </PortalToFollowElemContent>
  </PortalToFollowElem>
}
