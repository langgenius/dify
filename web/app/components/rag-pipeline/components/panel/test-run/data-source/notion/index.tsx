import type { NotionPage } from '@/models/common'
import NotionPageSelector from './notion-page-selector'

type NotionProps = {
  nodeId: string
  notionPages: NotionPage[]
  updateNotionPages: (value: NotionPage[]) => void
  canPreview?: boolean
  onPreview?: (selectedPage: NotionPage) => void
  isInPipeline?: boolean
}

const Notion = ({
  nodeId,
  notionPages,
  updateNotionPages,
  canPreview = false,
  onPreview,
  isInPipeline = false,
}: NotionProps) => {
  return (
    <NotionPageSelector
      nodeId={nodeId}
      value={notionPages.map(page => page.page_id)}
      onSelect={updateNotionPages}
      canPreview={canPreview}
      onPreview={onPreview}
      isInPipeline={isInPipeline}
    />
  )
}

export default Notion
