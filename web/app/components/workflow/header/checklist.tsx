import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  getIncomers,
  getOutgoers,
  useEdges,
  useNodes,
} from 'reactflow'
import BlockIcon from '../block-icon'
import {
  useNodesExtraData,
  useNodesInteractions,
} from '../hooks'
import type { CommonNodeType } from '../types'
import { BlockEnum } from '../types'
import { useStore } from '../store'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  Checklist,
  ChecklistSquare,
  XClose,
} from '@/app/components/base/icons/src/vender/line/general'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'

const WorkflowChecklist = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const nodes = useNodes<CommonNodeType>()
  const edges = useEdges()
  const nodesExtraData = useNodesExtraData()
  const { handleNodeSelect } = useNodesInteractions()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)

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

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{
        mainAxis: 12,
        crossAxis: 4,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className='relative flex items-center justify-center p-0.5 w-8 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs'>
          <div
            className={`
              group flex items-center justify-center w-full h-full rounded-md cursor-pointer 
              hover:bg-primary-50
              ${open && 'bg-primary-50'}
            `}
          >
            <Checklist
              className={`
                w-4 h-4 group-hover:text-primary-600
                ${open ? 'text-primary-600' : 'text-gray-500'}`
              }
            />
          </div>
          {
            !!needWarningNodes.length && (
              <div className='absolute -right-1.5 -top-1.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full border border-gray-100 text-white text-[11px] font-semibold bg-[#F79009]'>
                {needWarningNodes.length}
              </div>
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[12]'>
        <div
          className='w-[420px] rounded-2xl bg-white border-[0.5px] border-black/5 shadow-lg overflow-y-auto'
          style={{
            maxHeight: 'calc(2 / 3 * 100vh)',
          }}
        >
          <div className='sticky top-0 bg-white flex items-center pl-4 pr-3 pt-3 h-[44px] text-md font-semibold text-gray-900 z-[1]'>
            <div className='grow'>{t('workflow.panel.checklist')}{needWarningNodes.length ? `(${needWarningNodes.length})` : ''}</div>
            <div
              className='shrink-0 flex items-center justify-center w-6 h-6 cursor-pointer'
              onClick={() => setOpen(false)}
            >
              <XClose className='w-4 h-4 text-gray-500' />
            </div>
          </div>
          <div className='py-2'>
            {
              !!needWarningNodes.length && (
                <>
                  <div className='px-4 text-xs text-gray-400'>{t('workflow.panel.checklistTip')}</div>
                  <div className='px-4 py-2'>
                    {
                      needWarningNodes.map(node => (
                        <div
                          key={node.id}
                          className='mb-2 last-of-type:mb-0 border-[0.5px] border-gray-200 bg-white shadow-xs rounded-lg cursor-pointer'
                          onClick={() => handleNodeSelect(node.id)}
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
                </>
              )
            }
            {
              !needWarningNodes.length && (
                <div className='mx-4 mb-3 py-4 rounded-lg bg-gray-50 text-gray-400 text-xs text-center'>
                  <ChecklistSquare className='mx-auto mb-[5px] w-8 h-8 text-gray-300' />
                  {t('workflow.panel.checklistResolved')}
                </div>
              )
            }
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(WorkflowChecklist)
