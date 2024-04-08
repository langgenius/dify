import { type FC, useEffect, useState } from 'react'
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
  useEffect(() => {
    (async () => {
      if (data.dataset_ids?.length > 0) {
        const { data: dataSetsWithDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: data.dataset_ids } })
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
          <div key={id} className='flex items-center h-[26px] bg-gray-100 rounded-md  px-1 text-xs font-normal text-gray-700'>
            <div className='mr-1 shrink-0 p-1 bg-[#F5F8FF] rounded-md border-[0.5px] border-[#E0EAFF]'>
              <Folder className='w-3 h-3 text-[#444CE7]' />
            </div>
            <div className='text-xs font-normal text-gray-700'>
              {name}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(Node)
