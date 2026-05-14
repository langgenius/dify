'use client'
import type { CustomCollectionBackend } from '../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { createCustomCollection } from '@/service/tools'
import CreateEntryCard from './create-entry-card'

type Props = {
  onRefreshData: () => void
}

const Contribute = ({ onRefreshData }: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { isCurrentWorkspaceManager } = useAppContext()

  const linkUrl = useMemo(() => docLink('/use-dify/nodes/tools'), [docLink])
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
          linkUrl={linkUrl}
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
