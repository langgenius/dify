import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  getIncomers,
  getOutgoers,
  useEdges,
  useNodes,
} from 'reactflow'
import BlockIcon from '../block-icon'
import { useNodesExtraData } from '../hooks'
import type { CommonNodeType } from '../types'
import { BlockEnum } from '../types'
import { useStore } from '../store'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { FileCheck02 } from '@/app/components/base/icons/src/vender/line/files'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'

const WorkflowInfo = () => {
  const { t } = useTranslation()
  const appDetail = useAppStore(state => state.appDetail)
  const nodes = useNodes<CommonNodeType>()
  const edges = useEdges()
  const nodesExtraData = useNodesExtraData()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const needConnectNodes = nodes.filter((node) => {
    const incomers = getIncomers(node, nodes, edges)
    const outgoers = getOutgoers(node, nodes, edges)

    return !incomers.length && !outgoers.length
  })

  const needWarningNodes = useMemo(() => {
    const list = []

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const incomers = getIncomers(node, nodes, edges)
      const outgoers = getOutgoers(node, nodes, edges)
      const { errorMessage } = nodesExtraData[node.data.type].checkValid(node.data, t)
      let toolIcon

      if (node.data.type === BlockEnum.Tool) {
        if (node.data.provider_type === 'builtin')
          toolIcon = buildInTools.find(tool => tool.id === node.data.provider_id)?.icon

        if (node.data.provider_type === 'custom')
          toolIcon = customTools.find(tool => tool.id === node.data.provider_id)?.icon
      }

      if (errorMessage || ((!incomers.length && !outgoers.length))) {
        list.push({
          id: node.id,
          type: node.data.type,
          title: node.data.title,
          toolIcon,
          unConnected: !incomers.length && !outgoers.length,
          errorMessage,
        })
      }
    }

    return list
  }, [t, nodes, edges, nodesExtraData, buildInTools, customTools])

  if (!appDetail)
    return null

  return (
    <div className='w-[420px] h-full bg-white shadow-lg border-[0.5px] border-gray-200 rounded-2xl overflow-y-auto'>
      <div className='sticky top-0 bg-white border-b-[0.5px] border-black/5'>
        <div className='flex pt-4 px-4 pb-1'>
          <AppIcon
            className='mr-3'
            size='large'
            icon={appDetail.icon}
            background={appDetail.icon_background}
          />
          <div className='mt-2 text-base font-semibold text-gray-900'>
            {appDetail.name}
          </div>
        </div>
        <div className='px-4 py-[13px] text-xs leading-[18px] text-gray-500'>
          {appDetail.description}
        </div>
        <div className='flex items-center px-4 h-[42px] text-[13px] font-semibold text-gray-700'>
          <FileCheck02 className='mr-1 w-4 h-4' />
          {t('workflow.panel.checklist')}({needConnectNodes.length})
        </div>
      </div>
      <div className='py-2'>
        <div className='px-4 py-2 text-xs text-gray-400'>
          {t('workflow.panel.checklistTip')}
        </div>
        <div className='px-4 py-2'>
          {
            needWarningNodes.map(node => (
              <div
                key={node.id}
                className='mb-2 border-[0.5px] border-gray-200 bg-white shadow-xs rounded-lg'
              >
                <div className='flex items-center p-2 h-9 text-xs font-medium text-gray-700'>
                  <BlockIcon
                    type={node.type}
                    className='mr-1.5'
                    toolIcon={node.toolIcon}
                  />
                  {node.title}
                </div>
                {
                  node.unConnected && (
                    <div className='px-3 py-2 border-t-[0.5px] border-t-black/[0.02] bg-gray-25 rounded-b-lg'>
                      <div className='flex text-xs leading-[18px] text-gray-500'>
                        <AlertTriangle className='mt-[3px] mr-2 w-3 h-3 text-[#F79009]' />
                        {t('workflow.common.needConnecttip')}
                      </div>
                    </div>
                  )
                }
                {
                  node.errorMessage && (
                    <div className='px-3 py-2 border-t-[0.5px] border-t-black/[0.02] bg-gray-25 rounded-b-lg'>
                      <div className='flex text-xs leading-[18px] text-gray-500'>
                        <AlertTriangle className='mt-[3px] mr-2 w-3 h-3 text-[#F79009]' />
                        {node.errorMessage}
                      </div>
                    </div>
                  )
                }
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

export default memo(WorkflowInfo)
