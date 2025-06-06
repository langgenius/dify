import type { NotionPage } from '@/models/common'
import OnlineDocumentSelector from './online-document-selector'

type OnlineDocumentsProps = {
  nodeId: string
  headerInfo: {
    title: string
    docTitle: string
    docLink: string
  }
  onlineDocuments: NotionPage[]
  updateOnlineDocuments: (value: NotionPage[]) => void
  canPreview?: boolean
  onPreview?: (selectedPage: NotionPage) => void
  isInPipeline?: boolean
}

const OnlineDocuments = ({
  nodeId,
  headerInfo,
  onlineDocuments,
  updateOnlineDocuments,
  canPreview = false,
  onPreview,
  isInPipeline = false,
}: OnlineDocumentsProps) => {
  return (
    <OnlineDocumentSelector
      nodeId={nodeId}
      headerInfo={headerInfo}
      value={onlineDocuments.map(page => page.page_id)}
      onSelect={updateOnlineDocuments}
      canPreview={canPreview}
      onPreview={onPreview}
      isInPipeline={isInPipeline}
    />
  )
}

export default OnlineDocuments
