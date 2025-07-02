import { type FC, useEffect, useState } from 'react'
import React from 'react'
import type { KnowledgeRetrievalNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import type { DataSet } from '@/models/datasets'
import { useDatasetsDetailStore } from '../../datasets-detail-store/store'
import AppIcon from '@/app/components/base/app-icon'

const Node: FC<NodeProps<KnowledgeRetrievalNodeType>> = ({
  data,
}) => {
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>([])
  const datasetsDetail = useDatasetsDetailStore(s => s.datasetsDetail)

  useEffect(() => {
    if (data.dataset_ids?.length > 0) {
      const dataSetsWithDetail = data.dataset_ids.reduce<DataSet[]>((acc, id) => {
        if (datasetsDetail[id])
          acc.push(datasetsDetail[id])
        return acc
      }, [])
      setSelectedDatasets(dataSetsWithDetail)
    }
    else {
      setSelectedDatasets([])
    }
  }, [data.dataset_ids, datasetsDetail])

  if (!selectedDatasets.length)
    return null

  return (
    <div className='mb-1 px-3 py-1'>
      <div className='space-y-0.5'>
        {selectedDatasets.map(({ id, name, icon_info }) => (
          <div key={id} className='flex h-[26px] items-center gap-x-1 rounded-md bg-workflow-block-parma-bg px-1'>
            <AppIcon
              size='xs'
              iconType={icon_info.icon_type}
              icon={icon_info.icon}
              background={icon_info.icon_type === 'image' ? undefined : icon_info.icon_background}
              imageUrl={icon_info.icon_type === 'image' ? icon_info.icon_url : undefined}
              className='shrink-0'
            />
            <div className='system-xs-regular w-0 grow truncate text-text-secondary'>
              {name}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(Node)
