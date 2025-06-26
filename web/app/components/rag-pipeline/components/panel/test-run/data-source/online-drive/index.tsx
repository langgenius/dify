import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import Connect from './connect'

type OnlineDriveProps = {
  nodeData: DataSourceNodeType
}

const OnlineDrive = ({
  nodeData,
}: OnlineDriveProps) => {
  return (
    <Connect nodeData={nodeData} />
  )
}

export default OnlineDrive
