'use client'
import type { CustomCollectionBackend } from '../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { useAppContext } from '@/context/app-context'
import { createCustomCollection } from '@/service/tools'
import CreateEntryCard from './create-entry-card'

const CUSTOM_TOOL_DOC_URL = 'https://docs.dify.ai/en/use-dify/workspace/tools#custom-tool'

type Props = {
  onRefreshData: () => void
}

const Contribute = ({ onRefreshData }: Props) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()

  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)
  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await createCustomCollection(data)
    toast.success(t('api.actionSuccess', { ns: 'common' }))
    setIsShowEditCustomCollectionModal(false)
    onRefreshData()
  }

  return (
    <>
      {isCurrentWorkspaceManager && (
        <CreateEntryCard
          title={t('createSwaggerAPIAsTool', { ns: 'tools' })}
          linkText={t('swaggerAPIAsToolTip', { ns: 'tools' })}
          linkUrl={CUSTOM_TOOL_DOC_URL}
          onCreate={() => setIsShowEditCustomCollectionModal(true)}
        />
      )}
      {isShowEditCollectionToolModal && (
        <EditCustomToolModal
          payload={null}
          onHide={() => setIsShowEditCustomCollectionModal(false)}
          onAdd={doCreateCustomToolCollection}
        />
      )}
    </>
  )
}
export default Contribute
