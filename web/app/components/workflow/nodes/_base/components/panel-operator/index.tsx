import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import produce from 'immer'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import type { OffsetOptions } from '@floating-ui/react'
import ChangeBlock from './change-block'
import { useStore } from '@/app/components/workflow/store'
import {
  useNodesExtraData,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { DotsHorizontal } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import {
  fetchBuiltInToolList,
  fetchCustomToolList,
} from '@/service/tools'

type PanelOperatorProps = {
  id: string
  data: Node['data']
  triggerClassName?: string
  offset?: OffsetOptions
  onOpenChange?: (open: boolean) => void
}
const PanelOperator = ({
  id,
  data,
  triggerClassName,
  offset = {
    mainAxis: 4,
    crossAxis: 53,
  },
  onOpenChange,
}: PanelOperatorProps) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const edges = useEdges()
  const { handleNodeDelete } = useWorkflow()
  const nodesExtraData = useNodesExtraData()
  const toolsets = useStore(s => s.toolsets)
  const toolsMap = useStore(s => s.toolsMap)
  const setToolsMap = useStore(s => s.setToolsMap)
  const [open, setOpen] = useState(false)
  const fetchToolList = useMemo(() => {
    const toolset = toolsets.find(toolset => toolset.id === data.provider_id)
    return toolset?.type === 'api' ? fetchCustomToolList : fetchBuiltInToolList
  }, [toolsets, data.provider_id])

  const handleGetAbout = useCallback(() => {
    if (data.provider_id && !toolsMap[data.provider_id]?.length && open) {
      fetchToolList(data.provider_id).then((list: any) => {
        setToolsMap(produce(toolsMap, (draft) => {
          draft[data.provider_id as string] = list
        }))
      })
    }
  }, [data, toolsMap, fetchToolList, setToolsMap, open])
  useEffect(() => {
    handleGetAbout()
  }, [handleGetAbout])

  const edge = edges.find(edge => edge.target === id)

  const author = useMemo(() => {
    if (data.type !== BlockEnum.Tool)
      return nodesExtraData[data.type].author

    const toolset = toolsets.find(toolset => toolset.id === data.provider_id)

    return toolset?.author
  }, [data, nodesExtraData, toolsets])

  const about = useMemo(() => {
    if (data.type !== BlockEnum.Tool)
      return nodesExtraData[data.type].about

    const tool = toolsMap[data.provider_id as string]?.find(tool => tool.name === data.tool_name)

    return tool?.description[language] || ''
  }, [data, nodesExtraData, toolsMap, language])

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)

    if (onOpenChange)
      onOpenChange(newOpen)
  }, [onOpenChange])

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={offset}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PortalToFollowElemTrigger onClick={() => handleOpenChange(!open)}>
        <div
          className={`
            flex items-center justify-center w-6 h-6 rounded-md cursor-pointer
            hover:bg-black/5
            ${open && 'bg-black/5'}
            ${triggerClassName}
          `}
        >
          <DotsHorizontal className='w-4 h-4 text-gray-700' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[240px] border-[0.5px] border-gray-200 rounded-2xl shadow-xl bg-white'>
          <div className='p-1'>
            {
              data.type !== BlockEnum.Start && (
                <ChangeBlock
                  nodeId={id}
                  sourceHandle={edge?.sourceHandle || 'source'}
                />
              )
            }
            <div className='flex items-center px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'>
              {t('workflow.panel.helpLink')}
            </div>
          </div>
          {
            data.type !== BlockEnum.Start && (
              <>
                <div className='h-[1px] bg-gray-100'></div>
                <div className='p-1'>
                  <div
                    className={`
                    flex items-center px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer
                    hover:bg-rose-50 hover:text-red-500
                    `}
                    onClick={() => handleNodeDelete(id)}
                  >
                    {t('common.operation.delete')}
                  </div>
                </div>
              </>
            )
          }
          <div className='h-[1px] bg-gray-100'></div>
          <div className='p-1'>
            <div className='px-3 py-2 text-xs text-gray-500'>
              <div className='flex items-center mb-1 h-[22px] font-medium'>
                {t('workflow.panel.about')}
              </div>
              <div className='text-gray-500 leading-[18px]'>{about}</div>
              <div className='my-2 h-[0.5px] bg-black/5'></div>
              <div className='leading-[18px]'>
                {t('workflow.panel.createdBy')} {author}
              </div>
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(PanelOperator)
