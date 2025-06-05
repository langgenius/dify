import type { NotionPage } from '@/models/common'
import NotionPageSelector from './notion-page-selector'

type NotionProps = {
  nodeId: string
  headerInfo: {
    title: string
    docTitle: string
    docLink: string
  }
  notionPages: NotionPage[]
  updateNotionPages: (value: NotionPage[]) => void
  canPreview?: boolean
  onPreview?: (selectedPage: NotionPage) => void
  isInPipeline?: boolean
}

const Notion = ({
  nodeId,
  headerInfo,
  notionPages,
  updateNotionPages,
  canPreview = false,
  onPreview,
  isInPipeline = false,
}: NotionProps) => {
  return (
    <NotionPageSelector
      nodeId={nodeId}
      headerInfo={headerInfo}
      value={notionPages.map(page => page.page_id)}
      onSelect={updateNotionPages}
      canPreview={canPreview}
      onPreview={onPreview}
      isInPipeline={isInPipeline}
    />
  )
}

export default Notion
