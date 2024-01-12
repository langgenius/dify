'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import ChooseTool from './choose-tool'
import { selectedToolList as list } from '@/app/components/tools/mock-data'
import Panel from '@/app/components/app/configuration/base/feature-panel'
import Tooltip from '@/app/components/base/tooltip'
import { HelpCircle, Settings01, Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import { ToolsActive } from '@/app/components/base/icons/src/public/header-nav/tools'
import AppIcon from '@/app/components/base/app-icon'
import Switch from '@/app/components/base/switch'

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
  const [isShowChooseTool, setIsShowChooseTool] = useState(false)

  return (
    <>
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
            {list.length < MAX_TOOLS_NUM && (
              <>
                <div className='ml-3 mr-1 h-3.5 w-px bg-gray-200'></div>
                <OperationBtn type="add" onClick={() => {
                  setIsShowChooseTool(true)
                }} />
              </>
            )}
          </div>
        }
      >
        <div className='flex items-center flex-wrap justify-between'>
          {list.map((item: any, index) => (
            <div key={item.id}
              className={cn(item.enable && 'shadow-xs', index > 1 && 'mt-1', 'group relative flex justify-between items-center last-of-type:mb-0  pl-2.5 py-2 pr-3 w-full bg-white rounded-lg border-[0.5px] border-gray-200 ')}
              style={{
                width: 'calc(50% - 2px)',
              }}
            >
              <div className='flex items-center'>
                <AppIcon
                  className={cn(!item.enabled && 'opacity-50', 'mr-2 !rounded-md')}
                  size='tiny'
                  icon='🤖'
                  background='#F5F7FA'
                />
                <div
                  title={item.name}
                  className='max-w-[70px] leading-[18px] text-[13px] font-medium text-gray-800  truncate'
                >
                  {item.name}
                </div>
              </div>
              <div className='flex items-center'>
                <div className='hidden group-hover:flex items-center'>
                  <div className='mr-1 p-1 rounded-md hover:bg-black/5  cursor-pointer' onClick={() => { }}>
                    <Settings01 className='w-4 h-4 text-gray-500' />
                  </div>
                  <div className='p-1 rounded-md hover:bg-black/5 cursor-pointer' onClick={() => { }}>
                    <Trash03 className='w-4 h-4 text-gray-500' />
                  </div>
                  <div className='ml-2 mr-3 w-px h-3.5 bg-gray-200'></div>
                </div>
                <Switch defaultValue={item.enabled} size='md' onChange={() => { }} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
      {isShowChooseTool && (
        <ChooseTool
          show
          onHide={() => setIsShowChooseTool(false)}
        />
      )}
    </>
  )
}
export default React.memo(AgentTools)
