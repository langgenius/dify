import React, { useCallback, useMemo, useState } from 'react'
import Item from './item'
import { RiAddCircleFill, RiFileUploadLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import CreateFromScratch from './create-from-scratch'
import { useRouter, useSearchParams } from 'next/navigation'
import CreateFromDSLModal, { CreateFromDSLModalTab } from './create-from-dsl-modal'
import { useProviderContextSelector } from '@/context/provider-context'
import { useTranslation } from 'react-i18next'

const CreateOptions = () => {
  const { t } = useTranslation()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)

  const onPlanInfoChanged = useProviderContextSelector(state => state.onPlanInfoChanged)
  const searchParams = useSearchParams()
  const { replace } = useRouter()
  const dslUrl = searchParams.get('remoteInstallUrl') || undefined

  const activeTab = useMemo(() => {
    if (dslUrl)
      return CreateFromDSLModalTab.FROM_URL

    return undefined
  }, [dslUrl])

  const openCreateFromScratch = useCallback(() => {
    setShowCreateModal(true)
  }, [])

  const closeCreateFromScratch = useCallback(() => {
    setShowCreateModal(false)
  }, [])

  const openImportFromDSL = useCallback(() => {
    setShowImportModal(true)
  }, [])

  const onCloseImportModal = useCallback(() => {
    setShowImportModal(false)
    if (dslUrl)
      replace('/datasets/create-from-pipeline')
  }, [dslUrl, replace])

  const onImportFromDSLSuccess = useCallback(() => {
    onPlanInfoChanged()
  }, [onPlanInfoChanged])

  return (
    <div className='flex items-center gap-x-3 px-16 py-2'>
      <Item
        Icon={RiAddCircleFill}
        title={t('datasetPipeline.creation.createFromScratch.title')}
        description={t('datasetPipeline.creation.createFromScratch.description')}
        onClick={openCreateFromScratch}
      />
      <Item
        Icon={RiFileUploadLine}
        title={t('datasetPipeline.creation.ImportDSL.title')}
        description={t('datasetPipeline.creation.ImportDSL.description')}
        onClick={openImportFromDSL}
      />
      <Modal
        isShow={showCreateModal}
        onClose={closeCreateFromScratch}
        className='max-w-[520px] p-0'
      >
        <CreateFromScratch
          onClose={closeCreateFromScratch}
        />
      </Modal>
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

export default React.memo(CreateOptions)
