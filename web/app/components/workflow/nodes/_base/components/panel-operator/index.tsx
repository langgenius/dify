import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import type { OffsetOptions } from '@floating-ui/react'
import ChangeBlock from './change-block'
import { useStore } from '@/app/components/workflow/store'
import {
  useNodesExtraData,
  useNodesInteractions,
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import { DotsHorizontal } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetLanguage } from '@/context/i18n'

type PanelOperatorProps = {
  id: string
  data: Node['data']
  triggerClassName?: string
  offset?: OffsetOptions
  onOpenChange?: (open: boolean) => void
  inNode?: boolean
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
  inNode,
}: PanelOperatorProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const edges = useEdges()
  const { handleNodeDelete } = useNodesInteractions()
  const { nodesReadOnly } = useNodesReadOnly()
  const nodesExtraData = useNodesExtraData()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const [open, setOpen] = useState(false)
  const edge = edges.find(edge => edge.target === id)
  const author = useMemo(() => {
    if (data.type !== BlockEnum.Tool)
      return nodesExtraData[data.type].author

    if (data.provider_type === 'builtin')
      return buildInTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.author

    return customTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.author
  }, [data, nodesExtraData, buildInTools, customTools])

  const about = useMemo(() => {
    if (data.type !== BlockEnum.Tool)
      return nodesExtraData[data.type].about

    if (data.provider_type === 'builtin')
      return buildInTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.description[language]

    return customTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.description[language]
  }, [data, nodesExtraData, language, buildInTools, customTools])

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
          <DotsHorizontal className={`w-4 h-4 ${inNode ? 'text-gray-500' : 'text-gray-700'}`} />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[240px] border-[0.5px] border-gray-200 rounded-lg shadow-xl bg-white'>
          <div className='p-1'>
            {
              data.type !== BlockEnum.Start && !nodesReadOnly && (
                <ChangeBlock
                  nodeId={id}
                  nodeType={data.type}
                  sourceHandle={edge?.sourceHandle || 'source'}
                />
              )
            }
            <a
              href={
                language === 'zh_Hans'
                  ? 'https://docs.dify.ai/v/zh-hans/guides/workflow'
                  : 'https://docs.dify.ai/features/workflow'
              }
              target='_blank'
              className='flex items-center px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
            >
              {t('workflow.panel.helpLink')}
            </a>
          </div>
          {
            data.type !== BlockEnum.Start && !nodesReadOnly && (
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
                {t('workflow.panel.about').toLocaleUpperCase()}
              </div>
              <div className='mb-1 text-gray-700 leading-[18px]'>{about}</div>
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
