'use client'
import type { CustomCollectionBackend } from '../types'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { createCustomCollection } from '@/service/tools'
import CreateEntryCard from './create-entry-card'

type Props = Readonly<{
  onRefreshData: () => void
}>

function useCustomToolCreateAction({ onRefreshData }: Props) {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)

  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await createCustomCollection(data)
    toast.success(t('api.actionSuccess', { ns: 'common' }))
    setIsShowEditCustomCollectionModal(false)
    onRefreshData()
  }

  return {
    doCreateCustomToolCollection,
    isCurrentWorkspaceManager,
    isShowEditCollectionToolModal,
    setIsShowEditCustomCollectionModal,
  }
}

export const NewCustomToolButton = ({ onRefreshData }: Props) => {
  const { t } = useTranslation()
  const addSwaggerAPIAsToolLabel = t('addSwaggerAPIAsTool', { ns: 'tools' })
  const {
    doCreateCustomToolCollection,
    isCurrentWorkspaceManager,
    isShowEditCollectionToolModal,
    setIsShowEditCustomCollectionModal,
  } = useCustomToolCreateAction({ onRefreshData })

  if (!isCurrentWorkspaceManager)
    return null

  return (
    <>
      <Button
        variant="secondary"
        className="gap-0.5 px-3!"
        onClick={() => setIsShowEditCustomCollectionModal(true)}
        title={addSwaggerAPIAsToolLabel}
        aria-label={addSwaggerAPIAsToolLabel}
      >
        <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
        {addSwaggerAPIAsToolLabel}
      </Button>
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

const Contribute = ({ onRefreshData }: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const {
    doCreateCustomToolCollection,
    isCurrentWorkspaceManager,
    isShowEditCollectionToolModal,
    setIsShowEditCustomCollectionModal,
  } = useCustomToolCreateAction({ onRefreshData })

  return (
    <>
      {isCurrentWorkspaceManager && (
        <CreateEntryCard
          className="min-w-0"
          title={t('createSwaggerAPIAsTool', { ns: 'tools' })}
          linkText={t('swaggerAPIAsToolTip', { ns: 'tools' })}
          linkUrl={`${docLink('/use-dify/workspace/tools' as DocPathWithoutLang)}#custom-tool`}
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
