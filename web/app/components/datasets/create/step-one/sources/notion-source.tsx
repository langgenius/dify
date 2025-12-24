'use client'
import type { NotionSourceProps } from '../types'
import NotionConnector from '@/app/components/base/notion-connector'
import { NotionPageSelector } from '@/app/components/base/notion-page-selector'
import NextStepButton from '../common/next-step-button'
import VectorSpaceAlert from '../common/vector-space-alert'

/**
 * Notion data source component
 * Handles Notion page selection for dataset creation
 */
const NotionSource = ({
  datasetId,
  notionPages,
  notionCredentialId,
  updateNotionPages,
  updateNotionCredentialId,
  onPreview,
  onSetting,
  isShowVectorSpaceFull,
  onStepChange,
  isNotionAuthed,
  notionCredentialList,
}: NotionSourceProps) => {
  const nextDisabled = isShowVectorSpaceFull || !notionPages.length

  if (!isNotionAuthed) {
    return <NotionConnector onSetting={onSetting} />
  }

  return (
    <>
      <div className="mb-8 w-[640px]">
        <NotionPageSelector
          value={notionPages.map(page => page.page_id)}
          onSelect={updateNotionPages}
          onPreview={onPreview}
          credentialList={notionCredentialList}
          onSelectCredential={updateNotionCredentialId}
          datasetId={datasetId}
        />
      </div>
      <VectorSpaceAlert show={isShowVectorSpaceFull} />
      <NextStepButton disabled={nextDisabled} onClick={onStepChange} />
    </>
  )
}

export default NotionSource
