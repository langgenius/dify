import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/24/solid'
import cn from 'classnames'
import Indicator from '../../../indicator'
import Operate from './operate'
import s from './style.module.css'
import NotionIcon from '@/app/components/base/notion-icon'
import type { DataSourceNotion as TDataSourceNotion } from '@/models/common'
import { useAppContext } from '@/context/app-context'
import { fetchNotionConnection } from '@/service/common'

type DataSourceNotionProps = {
  workspaces: TDataSourceNotion[]
}
const DataSourceNotion = ({
  workspaces,
}: DataSourceNotionProps) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const [canConnectNotion, setCanConnectNotion] = useState(false)
  const { data } = useSWR(canConnectNotion ? '/oauth/data-source/notion' : null, fetchNotionConnection)

  const connected = !!workspaces.length

  const handleConnectNotion = () => {
    if (!isCurrentWorkspaceManager)
      return

    setCanConnectNotion(true)
  }

  const handleAuthAgain = () => {
    if (data?.data)
      window.location.href = data.data
    else
      setCanConnectNotion(true)
  }

  useEffect(() => {
    if (data?.data)
      window.location.href = data.data
  }, [data])

  return (
    <div className='mb-2 border-[0.5px] border-gray-200 bg-gray-50 rounded-xl'>
      <div className='flex items-center px-3 py-[9px]'>
        <div className={cn(s['notion-icon'], 'w-8 h-8 mr-3 border border-gray-100 rounded-lg')} />
        <div className='grow'>
          <div className='leading-5 text-sm font-medium text-gray-800'>
            {t('common.dataSource.notion.title')}
          </div>
          {
            !connected && (
              <div className='leading-5 text-xs text-gray-500'>
                {t('common.dataSource.notion.description')}
              </div>
            )
          }
        </div>
        {
          connected
            ? (
              <div
                className={
                  `flex items-center ml-3 px-3 h-7 bg-white border border-gray-200
                  rounded-md text-xs font-medium text-gray-700
                  ${isCurrentWorkspaceManager ? 'cursor-pointer' : 'grayscale opacity-50 cursor-default'}`
                }
                onClick={handleConnectNotion}
              >
                {t('common.dataSource.connect')}
              </div>
            )
            : (
              <div
                className={
                  `flex items-center px-3 h-7 bg-white border-[0.5px] border-gray-200 text-xs font-medium text-primary-600 rounded-md
                  ${isCurrentWorkspaceManager ? 'cursor-pointer' : 'grayscale opacity-50 cursor-default'}`
                }
                onClick={handleConnectNotion}
              >
                <PlusIcon className='w-[14px] h-[14px] mr-[5px]' />
                {t('common.dataSource.notion.addWorkspace')}
              </div>
            )
        }
      </div>
      {
        connected && (
          <div className='flex items-center px-3 h-[18px]'>
            <div className='text-xs font-medium text-gray-500'>
              {t('common.dataSource.notion.connectedWorkspace')}
            </div>
            <div className='grow ml-3 border-t border-t-gray-100' />
          </div>
        )
      }
      {
        connected && (
          <div className='px-3 pt-2 pb-3'>
            {
              workspaces.map(workspace => (
                <div className={cn(s['workspace-item'], 'flex items-center mb-1 py-1 pr-1 bg-white rounded-lg')} key={workspace.id}>
                  <NotionIcon
                    className='ml-3 mr-[6px]'
                    src={workspace.source_info.workspace_icon}
                    name={workspace.source_info.workspace_name}
                  />
                  <div className='grow py-[7px] leading-[18px] text-[13px] font-medium text-gray-700 truncate' title={workspace.source_info.workspace_name}>{workspace.source_info.workspace_name}</div>
                  {
                    workspace.is_bound
                      ? <Indicator className='shrink-0 mr-[6px]' />
                      : <Indicator className='shrink-0 mr-[6px]' color='yellow' />
                  }
                  <div className='shrink-0 mr-3 text-xs font-medium'>
                    {
                      workspace.is_bound
                        ? t('common.dataSource.notion.connected')
                        : t('common.dataSource.notion.disconnected')
                    }
                  </div>
                  <div className='mr-2 w-[1px] h-3 bg-gray-100' />
                  <Operate workspace={workspace} onAuthAgain={handleAuthAgain} />
                </div>
              ))
            }
          </div>
        )
      }
    </div>
  )
}

export default DataSourceNotion
