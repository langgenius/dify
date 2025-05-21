import type { NotionPage } from '@/models/common'
import NotionPageSelector from './notion-page-selector'

type NotionProps = {
  nodeId: string
  notionPages: NotionPage[]
  updateNotionPages: (value: NotionPage[]) => void
}

const Notion = ({
  nodeId,
  notionPages,
  updateNotionPages,
}: NotionProps) => {
  return (
    <NotionPageSelector
      nodeId={nodeId}
      value={notionPages.map(page => page.page_id)}
      onSelect={updateNotionPages}
      canPreview={false}
      isInPipeline
    />
  )
}

export default Notion
