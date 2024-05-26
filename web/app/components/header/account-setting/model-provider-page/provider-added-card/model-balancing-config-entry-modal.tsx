import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'

// create and export model balancing config modal
const ModelBalancingConfigEntryModal = () => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow={true}
      title={t('common.modelProvider.addConfig')}
    >
      <Form
        className="mt-4"
        itemClassName="mb-4"
        fieldLabelClassName="w-1/4"
        value={{}}
        onChange={() => { }}
        formSchemas={[]}
        validating={false}
        showOnVariableMap={{}}
        isEditMode={false}
        readonly={false}
        isShowDefaultValue={false}
      />
    </Modal>
  )
}

export default memo(ModelBalancingConfigEntryModal)
