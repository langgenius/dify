import {
  memo,
  useState,
} from 'react'
import { useNodeId } from 'reactflow'
import BlockIcon from '../block-icon'
import { useWorkflowContext } from '../context'
import {
  BLOCK_CLASSIFICATIONS,
  BLOCK_GROUP_BY_CLASSIFICATION,
  TABS,
} from './constants'

const Tabs = () => {
  const {
    nodes,
    handleAddNextNode,
  } = useWorkflowContext()
  const [activeTab, setActiveTab] = useState(TABS[0].key)
  const nodeId = useNodeId()
  const currentNode = nodes.find(node => node.id === nodeId)

  return (
    <div>
      <div className='flex items-center justify-between px-3 h-[34px] border-b-[0.5px] border-b-black/5'>
        {
          TABS.map(tab => (
            <div
              key={tab.key}
              className={`
                text-[13px] font-medium cursor-pointer
                ${activeTab === tab.key ? 'text-gray-700' : 'text-gray-500'}
              `}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.name}
            </div>
          ))
        }
      </div>
      <div className='p-1'>
        {
          BLOCK_CLASSIFICATIONS.map(classification => (
            <div
              key={classification}
              className='mb-1 last-of-type:mb-0'
            >
              {
                classification !== '-' && (
                  <div className='flex items-start px-3 h-[22px] text-xs font-medium text-gray-500'>
                    {classification}
                  </div>
                )
              }
              {
                BLOCK_GROUP_BY_CLASSIFICATION[classification].map(block => (
                  <div
                    key={block.type}
                    className='flex items-center px-3 h-8 rounded-lg hover:bg-gray-50 cursor-pointer'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleAddNextNode(currentNode!, block.type)
                    }}
                  >
                    <BlockIcon
                      className='mr-2'
                      type={block.type}
                    />
                    <div className='text-sm text-gray-900'>{block.title}</div>
                  </div>
                ))
              }
            </div>
          ))
        }
      </div>
    </div>
  )
}

export default memo(Tabs)
