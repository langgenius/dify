import { useBoolean } from 'ahooks'

const useEditDocumentMetadata = () => {
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

export default useEditDocumentMetadata
