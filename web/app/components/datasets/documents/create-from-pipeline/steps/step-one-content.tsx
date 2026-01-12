'use client'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { Node } from '@/app/components/workflow/types'
import { memo } from 'react'
import Divider from '@/app/components/base/divider'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import LocalFile from '@/app/components/datasets/documents/create-from-pipeline/data-source/local-file'
import OnlineDocuments from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents'
import OnlineDrive from '@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive'
import WebsiteCrawl from '@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl'
import { DatasourceType } from '@/models/pipeline'
import UpgradeCard from '../../../create/step-one/upgrade-card'
import Actions from '../actions'
import DataSourceOptions from '../data-source-options'

type StepOneContentProps = {
  datasource: Datasource | undefined
  datasourceType: string | undefined
  pipelineNodes: Node<DataSourceNodeType>[]
  supportBatchUpload: boolean
  localFileListLength: number
  isShowVectorSpaceFull: boolean
  showSelect: boolean
  totalOptions: number | undefined
  selectedOptions: number | undefined
  tip: string
  nextBtnDisabled: boolean
  onSelectDataSource: (dataSource: Datasource) => void
  onCredentialChange: (credentialId: string) => void
  onSelectAll: () => void
  onNextStep: () => void
}

const StepOneContent = ({
  datasource,
  datasourceType,
  pipelineNodes,
  supportBatchUpload,
  localFileListLength,
  isShowVectorSpaceFull,
  showSelect,
  totalOptions,
  selectedOptions,
  tip,
  nextBtnDisabled,
  onSelectDataSource,
  onCredentialChange,
  onSelectAll,
  onNextStep,
}: StepOneContentProps) => {
  const showUpgradeCard = !supportBatchUpload
    && datasourceType === DatasourceType.localFile
    && localFileListLength > 0

  return (
    <div className="flex flex-col gap-y-5 pt-4">
      <DataSourceOptions
        datasourceNodeId={datasource?.nodeId || ''}
        onSelect={onSelectDataSource}
        pipelineNodes={pipelineNodes}
      />
      {datasourceType === DatasourceType.localFile && (
        <LocalFile
          allowedExtensions={datasource!.nodeData.fileExtensions || []}
          supportBatchUpload={supportBatchUpload}
        />
      )}
      {datasourceType === DatasourceType.onlineDocument && (
        <OnlineDocuments
          nodeId={datasource!.nodeId}
          nodeData={datasource!.nodeData}
          onCredentialChange={onCredentialChange}
        />
      )}
      {datasourceType === DatasourceType.websiteCrawl && (
        <WebsiteCrawl
          nodeId={datasource!.nodeId}
          nodeData={datasource!.nodeData}
          onCredentialChange={onCredentialChange}
        />
      )}
      {datasourceType === DatasourceType.onlineDrive && (
        <OnlineDrive
          nodeId={datasource!.nodeId}
          nodeData={datasource!.nodeData}
          onCredentialChange={onCredentialChange}
        />
      )}
      {isShowVectorSpaceFull && <VectorSpaceFull />}
      <Actions
        showSelect={showSelect}
        totalOptions={totalOptions}
        selectedOptions={selectedOptions}
        onSelectAll={onSelectAll}
        disabled={nextBtnDisabled}
        handleNextStep={onNextStep}
        tip={tip}
      />
      {showUpgradeCard && (
        <>
          <Divider type="horizontal" className="my-4 h-px bg-divider-subtle" />
          <UpgradeCard />
        </>
      )}
    </div>
  )
}

export default memo(StepOneContent)
