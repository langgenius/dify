import { type FC, useEffect, useRef, useState } from 'react'
import React from 'react'
import type { KnowledgeRetrievalNodeType } from './types'
import { Folder } from '@/app/components/base/icons/src/vender/solid/files'
import type { NodeProps } from '@/app/components/workflow/types'
import { fetchDatasets } from '@/service/datasets'
import type { DataSet } from '@/models/datasets'

const Node: FC<NodeProps<KnowledgeRetrievalNodeType>> = ({
  data,
}) => {
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>([])
  const updateTime = useRef(0)
  useEffect(() => {
    (async () => {
      updateTime.current = updateTime.current + 1
      const currUpdateTime = updateTime.current

      if (data.dataset_ids?.length > 0) {
        const { data: dataSetsWithDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: data.dataset_ids } })
        //  avoid old data overwrite new data
        if (currUpdateTime < updateTime.current)
          return
        setSelectedDatasets(dataSetsWithDetail)
      }
      else {
        setSelectedDatasets([])
      }
    })()
  }, [data.dataset_ids])

  if (!selectedDatasets.length)
    return null

  return (
    <div className='mb-1 px-3 py-1'>
      <div className='space-y-0.5'>
        {selectedDatasets.map(({ id, name }) => (
          <div key={id} className='flex items-center h-[26px] bg-workflow-block-parma-bg rounded-md  px-1 text-xs font-normal text-gray-700'>
            <div className='mr-1 shrink-0 p-1 bg-[#F5F8FF] rounded-md border-[0.5px] border-[#E0EAFF]'>
              <Folder className='w-3 h-3 text-[#444CE7]' />
            </div>
            <div className='grow w-0 text-text-secondary system-xs-regular truncate'>
              {name}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(Node)
