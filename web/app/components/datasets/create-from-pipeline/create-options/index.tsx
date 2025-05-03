import React, { useCallback, useMemo, useState } from 'react'
import Item from './item'
import { RiAddCircleFill, RiFileUploadLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import CreateFromScratch from './create-from-scratch'
import { useRouter, useSearchParams } from 'next/navigation'
import CreateFromDSLModal, { CreateFromDSLModalTab } from './create-from-dsl-modal'
import { useProviderContextSelector } from '@/context/provider-context'

const CreateOptions = () => {
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

  const handleCreateFromScratch = useCallback(() => {
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
        title='Create from scratch'
        description='Blank knowledge pipeline'
        onClick={openCreateFromScratch}
      />
      <Item
        Icon={RiFileUploadLine}
        title='Import'
        description='Import from a DSL file'
        onClick={openImportFromDSL}
      />
      <Modal
        isShow={showCreateModal}
        onClose={closeCreateFromScratch}
        className='max-w-[520px] p-0'
      >
        <CreateFromScratch
          onClose={closeCreateFromScratch}
          onCreate={handleCreateFromScratch}
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
