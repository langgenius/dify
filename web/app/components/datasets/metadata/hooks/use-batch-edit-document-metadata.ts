import { useBoolean } from 'ahooks'

const useBatchEditDocumentMetadata = () => {
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  return {
    isShowEditModal,
    showEditModal,
    hideEditModal,
  }
}

export default useBatchEditDocumentMetadata
