'use client'
// import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
// import { useContext } from 'use-context-selector'
// import I18n from '@/context/i18n'
// import { getLanguage } from '@/i18n/language'
// import { useAppContext } from '@/context/app-context'
import { RiHammerFill } from '@remixicon/react'
import Indicator from '@/app/components/header/indicator'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { useFormatTimeFromNow } from './hooks'
import type { ToolWithProvider } from '../../workflow/types'
import cn from '@/utils/classnames'

type Props = {
  currentProvider?: ToolWithProvider
  data: ToolWithProvider
  handleSelect: (provider: ToolWithProvider) => void
}

const MCPCard = ({
  currentProvider,
  data,
  handleSelect,
}: Props) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  // const { locale } = useContext(I18n)
  // const language = getLanguage(locale)
  //   const { isCurrentWorkspaceManager } = useAppContext()

  return (
    <div
      onClick={() => handleSelect(data)}
      className={cn(
        'relative flex cursor-pointer flex-col rounded-xl border-[1.5px] border-transparent bg-components-card-bg shadow-xs hover:bg-components-card-bg-alt hover:shadow-md',
        currentProvider?.id === data.id && 'border-components-option-card-option-selected-border bg-components-card-bg-alt',
      )}
    >
      <div className='group flex grow items-center gap-3 rounded-t-xl p-4'>
        <div className='shrink-0 overflow-hidden rounded-xl border border-components-panel-border-subtle'>
          <Icon src={data.icon} />
        </div>
        <div className='grow'>
          <div className='system-md-semibold mb-1 truncate text-text-secondary' title={data.name}>{data.name}</div>
          <div className='flex items-center gap-2'>
            <div className='flex items-center gap-1'>
              <RiHammerFill className='h-3 w-3 shrink-0 text-text-quaternary' />
              {data.tools.length > 0 && (
                <div className='system-xs-regular grow text-text-tertiary'>{t('tools.mcp.toolsCount', { count: data.tools.length })}</div>
              )}
              {!data.tools.length && (
                <div className='system-xs-regular grow text-text-tertiary'>{t('tools.mcp.noTools')}</div>
              )}
            </div>
            <div className='system-xs-regular text-divider-deep'>/</div>
            <div className='system-xs-regular truncate text-text-tertiary'>{`${t('tools.mcp.updateTime')} ${formatTimeFromNow(data.update_elapsed_time! * 1000)}`}</div>
          </div>
        </div>
      </div>
      <div className='flex items-center gap-1 rounded-b-xl pb-2.5 pl-4 pr-2.5 pt-1.5'>
        <div className='system-xs-regular grow truncate text-text-tertiary' title={data.server_url}>{data.server_url}</div>
        {data.is_team_authorization && <Indicator color='green' />}
        {!data.is_team_authorization && (
          <div className='system-xs-medium flex shrink-0 items-center gap-1 rounded-md border border-util-colors-red-red-500 bg-components-badge-bg-red-soft px-1.5 py-0.5 text-util-colors-red-red-500'>
            {t('tools.mcp.noConfigured')}
            <Indicator color='red' />
          </div>
        )}
      </div>
    </div>
  )
}
export default MCPCard
