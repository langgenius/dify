import type { NotionPage } from '@/models/common'
import OnlineDocumentSelector from './online-document-selector'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'

type OnlineDocumentsProps = {
  nodeId: string
  nodeData: DataSourceNodeType
  onlineDocuments: NotionPage[]
  updateOnlineDocuments: (value: NotionPage[]) => void
  canPreview?: boolean
  onPreview?: (selectedPage: NotionPage) => void
  isInPipeline?: boolean
}

const OnlineDocuments = ({
  nodeId,
  nodeData,
  onlineDocuments,
  updateOnlineDocuments,
  canPreview = false,
  onPreview,
  isInPipeline = false,
}: OnlineDocumentsProps) => {
  return (
    <OnlineDocumentSelector
      nodeId={nodeId}
      nodeData={nodeData}
      value={onlineDocuments.map(page => page.page_id)}
      onSelect={updateOnlineDocuments}
      canPreview={canPreview}
      onPreview={onPreview}
      isInPipeline={isInPipeline}
    />
  )
}

export default OnlineDocuments
