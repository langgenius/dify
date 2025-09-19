import React from 'react'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useToolIcon } from '@/app/components/workflow/hooks'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'

type DatasourceProps = {
  nodeData: DataSourceNodeType
}

const Datasource = ({
  nodeData,
}: DatasourceProps) => {
  const toolIcon = useToolIcon(nodeData)

  return (
    <div className='flex items-center gap-x-1.5'>
      <div className='flex size-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default'>
        <BlockIcon
          className='size-3.5'
          type={BlockEnum.DataSource}
          toolIcon={toolIcon}
        />
      </div>
      <span className='system-sm-medium text-text-secondary'>{nodeData.title}</span>
    </div>
  )
}

export default React.memo(Datasource)
