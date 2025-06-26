import BlockIcon from '@/app/components/workflow/block-icon'
import { useToolIcon } from '@/app/components/workflow/hooks'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { BlockEnum } from '@/app/components/workflow/types'

type ConnectProps = {
  nodeData: DataSourceNodeType
}

const Connect = ({
  nodeData,
}: ConnectProps) => {
  const toolIcon = useToolIcon(nodeData)

  return (
    <div className='flex flex-col p-6'>
      <div className='flex size-12 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg p-1 shadow-lg shadow-shadow-shadow-5'>
        <BlockIcon
          type={BlockEnum.DataSource}
          toolIcon={toolIcon}
          size='md'
        />
      </div>
      <p className='mb-6 text-gray-600'>
        To connect your online drive, please follow the instructions provided by your service provider.
      </p>
      <button className='rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600'>
        Connect Now
      </button>
    </div>
  )
}

export default Connect
