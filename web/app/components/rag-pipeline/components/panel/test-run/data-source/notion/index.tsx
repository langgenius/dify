import { useDataSources } from '@/service/use-common'
import { useCallback, useMemo } from 'react'
import { NotionPageSelector } from '@/app/components/base/notion-page-selector'
import type { NotionPage } from '@/models/common'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import { NotionConnector } from '@/app/components/base/notion-connector'
import { useModalContextSelector } from '@/context/modal-context'

type NotionProps = {
  notionPages: NotionPage[]
  updateNotionPages: (value: NotionPage[]) => void
  isShowVectorSpaceFull: boolean
}

const Notion = ({
  notionPages,
  updateNotionPages,
  isShowVectorSpaceFull,
}: NotionProps) => {
  const { data: dataSources } = useDataSources()
  const setShowAccountSettingModal = useModalContextSelector(state => state.setShowAccountSettingModal)

  const hasConnection = useMemo(() => {
    const notionDataSources = dataSources?.data.filter(item => item.provider === 'notion') || []
    return notionDataSources.length > 0
  }, [dataSources])

  const handleConnect = useCallback(() => {
    setShowAccountSettingModal({ payload: 'data-source' })
  }, [setShowAccountSettingModal])

  return (
    <>
      {!hasConnection && <NotionConnector onSetting={handleConnect} />}
      {hasConnection && (
        <>
          <NotionPageSelector
            value={notionPages.map(page => page.page_id)}
            onSelect={updateNotionPages}
            canPreview={false}
          />
          {isShowVectorSpaceFull && (
            <VectorSpaceFull />
          )}
        </>
      )}
    </>
  )
}

export default Notion
