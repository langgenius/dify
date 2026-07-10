'use client'
import type { CustomCollectionBackend } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { useCanManageTools } from '@/app/components/tools/hooks/use-tool-permissions'
import { useDocLink } from '@/context/i18n'
import { createCustomCollection } from '@/service/tools'
import CreateEntryCard from './create-entry-card'

type Props = Readonly<{
  onRefreshData: () => void
}>

function useCustomToolCreateAction({ onRefreshData }: Props) {
  const { t } = useTranslation()
  const canManageTools = useCanManageTools()
  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)

  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    if (!canManageTools)
      return

    await createCustomCollection(data)
    toast.success(t($ => $['api.actionSuccess'], { ns: 'common' }))
    setIsShowEditCustomCollectionModal(false)
    onRefreshData()
  }

  return {
    canManageTools,
    doCreateCustomToolCollection,
    isShowEditCollectionToolModal,
    setIsShowEditCustomCollectionModal,
  }
}

export const NewCustomToolButton = ({ onRefreshData }: Props) => {
  const { t } = useTranslation()
  const addSwaggerAPIAsToolLabel = t($ => $.addSwaggerAPIAsTool, { ns: 'tools' })
  const {
    canManageTools,
    doCreateCustomToolCollection,
    isShowEditCollectionToolModal,
    setIsShowEditCustomCollectionModal,
  } = useCustomToolCreateAction({ onRefreshData })

  if (!canManageTools)
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
    canManageTools,
    doCreateCustomToolCollection,
    isShowEditCollectionToolModal,
    setIsShowEditCustomCollectionModal,
  } = useCustomToolCreateAction({ onRefreshData })

  return (
    <>
      {canManageTools && (
        <CreateEntryCard
          className="min-w-0"
          title={t($ => $.createSwaggerAPIAsTool, { ns: 'tools' })}
          linkText={t($ => $.swaggerAPIAsToolTip, { ns: 'tools' })}
          linkUrl={docLink('/use-dify/workspace/tools#swagger-api')}
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
