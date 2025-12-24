'use client'
import type { FileSourceProps } from '../types'
import { useMemo } from 'react'
import FileUploader from '../../file-uploader'
import NextStepButton from '../common/next-step-button'
import VectorSpaceAlert from '../common/vector-space-alert'
import UpgradeCard from '../upgrade-card'

/**
 * File data source component
 * Handles file upload functionality for dataset creation
 */
const FileSource = ({
  files,
  updateFileList,
  updateFile,
  onPreview,
  isShowVectorSpaceFull,
  onStepChange,
  shouldShowDataSourceTypeList,
  supportBatchUpload,
  enableBilling,
  isSandboxPlan,
}: FileSourceProps) => {
  const nextDisabled = useMemo(() => {
    if (!files.length)
      return true
    if (files.some(file => !file.file.id))
      return true
    return isShowVectorSpaceFull
  }, [files, isShowVectorSpaceFull])

  const showUpgradeCard = enableBilling && isSandboxPlan && files.length > 0

  return (
    <>
      <FileUploader
        fileList={files}
        titleClassName={!shouldShowDataSourceTypeList ? 'mt-[30px] !mb-[44px] !text-lg' : undefined}
        prepareFileList={updateFileList}
        onFileListUpdate={updateFileList}
        onFileUpdate={updateFile}
        onPreview={onPreview}
        supportBatchUpload={supportBatchUpload}
      />
      <VectorSpaceAlert show={isShowVectorSpaceFull} />
      <NextStepButton disabled={nextDisabled} onClick={onStepChange} />
      {showUpgradeCard && (
        <div className="mt-5">
          <div className="mb-4 h-px bg-divider-subtle"></div>
          <UpgradeCard />
        </div>
      )}
    </>
  )
}

export default FileSource
