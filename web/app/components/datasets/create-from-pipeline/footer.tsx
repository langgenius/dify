import { Separator } from '@langgenius/dify-ui/separator'
import { RiFileUploadLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from '@/next/navigation'
import CreateFromDSLModal, { CreateFromDSLModalTab } from './create-options/create-from-dsl-modal'

const Footer = () => {
  const { t } = useTranslation(['datasetPipeline'])

  const [showImportModal, setShowImportModal] = useState(false)

  const searchParams = useSearchParams()
  const { replace } = useRouter()
  const dslUrl = searchParams.get('remoteInstallUrl') || undefined

  const activeTab = useMemo(() => {
    if (dslUrl) return CreateFromDSLModalTab.FROM_URL

    return undefined
  }, [dslUrl])

  const openImportFromDSL = useCallback(() => {
    setShowImportModal(true)
  }, [])

  const onCloseImportModal = useCallback(() => {
    setShowImportModal(false)
    if (dslUrl) replace('/datasets/create-from-pipeline')
  }, [dslUrl, replace])

  return (
    <div className="absolute inset-s-0 inset-e-0 bottom-0 z-10 flex flex-col gap-y-4 bg-knowledge-pipeline-creation-footer-bg px-16 pb-6 backdrop-blur-[6px]">
      <Separator orientation="horizontal" className="my-0 h-[0.5px] w-8" />
      <button
        type="button"
        className="flex items-center gap-x-3 system-md-medium text-text-accent"
        onClick={openImportFromDSL}
      >
        <RiFileUploadLine className="size-5" />
        <span>{t(($) => $['creation.importDSL'], { ns: 'datasetPipeline' })}</span>
      </button>
      <CreateFromDSLModal
        show={showImportModal}
        onClose={onCloseImportModal}
        activeTab={activeTab}
        dslUrl={dslUrl}
      />
    </div>
  )
}

export default React.memo(Footer)
