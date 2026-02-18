import { RiFileUploadLine } from '@remixicon/react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import Divider from '../../base/divider'
import CreateFromDSLModal, { CreateFromDSLModalTab } from './create-options/create-from-dsl-modal'

const Footer = () => {
  const { t } = useTranslation()

  const [showImportModal, setShowImportModal] = useState(false)

  const searchParams = useSearchParams()
  const { replace } = useRouter()
  const dslUrl = searchParams.get('remoteInstallUrl') || undefined
  const invalidDatasetList = useInvalidDatasetList()

  const activeTab = useMemo(() => {
    if (dslUrl)
      return CreateFromDSLModalTab.FROM_URL

    return undefined
  }, [dslUrl])

  const openImportFromDSL = useCallback(() => {
    setShowImportModal(true)
  }, [])

  const onCloseImportModal = useCallback(() => {
    setShowImportModal(false)
    if (dslUrl)
      replace('/datasets/create-from-pipeline')
  }, [dslUrl, replace])

  const onImportFromDSLSuccess = useCallback(() => {
    invalidDatasetList()
  }, [invalidDatasetList])

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-y-4 bg-knowledge-pipeline-creation-footer-bg px-16 pb-6 backdrop-blur-[6px]">
      <Divider type="horizontal" className="my-0 w-8" />
      <button
        type="button"
        className="system-md-medium flex items-center gap-x-3 text-text-accent"
        onClick={openImportFromDSL}
      >
        <RiFileUploadLine className="size-5" />
        <span>{t('creation.importDSL', { ns: 'datasetPipeline' })}</span>
      </button>
      <CreateFromDSLModal
        show={showImportModal}
        onClose={onCloseImportModal}
        activeTab={activeTab}
        dslUrl={dslUrl}
        onSuccess={onImportFromDSLSuccess}
      />
    </div>
  )
}

export default React.memo(Footer)
