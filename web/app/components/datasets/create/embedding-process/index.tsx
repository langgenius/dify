import type { FC } from 'react'
import type { FullDocumentDetail } from '@/models/datasets'
import type { RETRIEVE_METHOD } from '@/types/app'
import {
  RiArrowRightLine,
  RiLoader2Fill,
  RiTerminalBoxLine,
} from '@remixicon/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import { Plan } from '@/app/components/billing/type'
import { useProviderContext } from '@/context/provider-context'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import { useProcessRule } from '@/service/knowledge/use-dataset'
import { useInvalidDocumentList } from '@/service/knowledge/use-document'
import IndexingProgressItem from './indexing-progress-item'
import RuleDetail from './rule-detail'
import UpgradeBanner from './upgrade-banner'
import { useIndexingStatusPolling } from './use-indexing-status-polling'
import { createDocumentLookup } from './utils'

type EmbeddingProcessProps = {
  datasetId: string
  batchId: string
  documents?: FullDocumentDetail[]
  indexingType?: string
  retrievalMethod?: RETRIEVE_METHOD
}

// Status header component
const StatusHeader: FC<{ isEmbedding: boolean, isCompleted: boolean }> = ({
  isEmbedding,
  isCompleted,
}) => {
  const { t } = useTranslation()

  return (
    <div className="system-md-semibold-uppercase flex items-center gap-x-1 text-text-secondary">
      {isEmbedding && (
        <>
          <RiLoader2Fill className="size-4 animate-spin" />
          <span>{t('embedding.processing', { ns: 'datasetDocuments' })}</span>
        </>
      )}
      {isCompleted && t('embedding.completed', { ns: 'datasetDocuments' })}
    </div>
  )
}

// Action buttons component
const ActionButtons: FC<{
  apiReferenceUrl: string
  onNavToDocuments: () => void
}> = ({ apiReferenceUrl, onNavToDocuments }) => {
  const { t } = useTranslation()

  return (
    <div className="mt-6 flex items-center gap-x-2 py-2">
      <Link href={apiReferenceUrl} target="_blank" rel="noopener noreferrer">
        <Button className="w-fit gap-x-0.5 px-3">
          <RiTerminalBoxLine className="size-4" />
          <span className="px-0.5">Access the API</span>
        </Button>
      </Link>
      <Button
        className="w-fit gap-x-0.5 px-3"
        variant="primary"
        onClick={onNavToDocuments}
      >
        <span className="px-0.5">{t('stepThree.navTo', { ns: 'datasetCreation' })}</span>
        <RiArrowRightLine className="size-4 stroke-current stroke-1" />
      </Button>
    </div>
  )
}

const EmbeddingProcess: FC<EmbeddingProcessProps> = ({
  datasetId,
  batchId,
  documents = [],
  indexingType,
  retrievalMethod,
}) => {
  const { enableBilling, plan } = useProviderContext()
  const router = useRouter()
  const invalidDocumentList = useInvalidDocumentList()
  const apiReferenceUrl = useDatasetApiAccessUrl()

  // Polling hook for indexing status
  const { statusList, isEmbedding, isEmbeddingCompleted } = useIndexingStatusPolling({
    datasetId,
    batchId,
  })

  // Get process rule for the first document
  const firstDocumentId = documents[0]?.id
  const { data: ruleDetail } = useProcessRule(firstDocumentId)

  // Document lookup utilities - memoized for performance
  const documentLookup = useMemo(
    () => createDocumentLookup(documents),
    [documents],
  )

  const handleNavToDocuments = () => {
    invalidDocumentList()
    router.push(`/datasets/${datasetId}/documents`)
  }

  const showUpgradeBanner = enableBilling && plan.type !== Plan.team

  return (
    <>
      <div className="flex flex-col gap-y-3">
        <StatusHeader isEmbedding={isEmbedding} isCompleted={isEmbeddingCompleted} />

        {showUpgradeBanner && <UpgradeBanner />}

        <div className="flex flex-col gap-0.5 pb-2">
          {statusList.map(detail => (
            <IndexingProgressItem
              key={detail.id}
              detail={detail}
              name={documentLookup.getName(detail.id)}
              sourceType={documentLookup.getSourceType(detail.id)}
              notionIcon={documentLookup.getNotionIcon(detail.id)}
              enableBilling={enableBilling}
            />
          ))}
        </div>

        <Divider type="horizontal" className="my-0 bg-divider-subtle" />

        <RuleDetail
          sourceData={ruleDetail}
          indexingType={indexingType}
          retrievalMethod={retrievalMethod}
        />
      </div>

      <ActionButtons
        apiReferenceUrl={apiReferenceUrl}
        onNavToDocuments={handleNavToDocuments}
      />
    </>
  )
}

export default EmbeddingProcess
