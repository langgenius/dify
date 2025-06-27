import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import Header from './header'

type OnlineDriveProps = {
  nodeData: DataSourceNodeType
}

const OnlineDrive = ({
  nodeData,
}: OnlineDriveProps) => {
  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        docTitle='Online Drive Docs'
        docLink='https://docs.dify.ai/'
      />
    </div>
  )
}

export default OnlineDrive
