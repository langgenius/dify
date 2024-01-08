'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import list from './mock'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import Tooltip from '@/app/components/base/tooltip'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import { ToolsActive } from '@/app/components/base/icons/src/public/header-nav/tools'
const MAX_TOOLS_NUM = 5
type Props = {
  onAdd: (item: any) => void
  onDeleted: (id: string) => void
  onChange: (id: string, item: any) => void // enable/disable
}

const AgentTools: FC<Props> = ({
  onAdd,
  onDeleted,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <Panel
      className="mt-4"
      headerIcon={
        <ToolsActive className='w-4 h-4 text-primary-500' />
      }
      title={
        <div className='flex items-center'>
          <div className='mr-1'>{t('appDebug.agent.tools.name')}</div>
          <Tooltip htmlContent={<div className='w-[180px]'>
            {t('appDebug.agent.tools.description')}
          </div>} selector='config-tools-tooltip'>
            <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
          </Tooltip>
        </div>
      }
      headerRight={
        <div className='flex items-center'>
          <div className='leading-[18px] text-xs font-normal text-gray-500'>{list.length}/{MAX_TOOLS_NUM}&nbsp;{t('appDebug.agent.tools.enabled')}</div>
          <div className='ml-3 mr-1 h-3.5 w-px bg-gray-200'></div>
          <OperationBtn type="add" onClick={() => {

          }} />
        </div>
      }
    >
      <div className='flex items-center space-y-1 flex-wrap justify-between'>
        {list.map((item: any) => (
          <div key={item.id}
            className='group relative flex items-center last-of-type:mb-0  pl-2.5 py-2 pr-3 w-full bg-white rounded-lg border-[0.5px] border-gray-200 shadow-xs'
            style={{
              width: 'calc(50% - 2px)',
            }}
          >
            <div>{item.name}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
export default React.memo(AgentTools)
