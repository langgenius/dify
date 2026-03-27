'use client'
import type { FC } from 'react'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import ConfigModalBody from './config-modal-body'
import { useConfigModalState } from './use-config-modal-state'

export type IConfigModalProps = {
  isCreate?: boolean
  payload?: InputVar
  isShow: boolean
  varKeys?: string[]
  onClose: () => void
  onConfirm: (newValue: InputVar, moreInfo?: MoreInfo) => void
  supportFile?: boolean
}

const ConfigModal: FC<IConfigModalProps> = ({
  isCreate,
  payload,
  isShow,
  onClose,
  onConfirm,
  supportFile,
}) => {
  const { t } = useTranslation()
  const modalState = useConfigModalState({
    payload,
    isShow,
    onConfirm,
    supportFile,
  })

  return (
    <Modal
      title={t(`variableConfig.${isCreate ? 'addModalTitle' : 'editModalTitle'}`, { ns: 'appDebug' })}
      isShow={isShow}
      onClose={onClose}
    >
      <ConfigModalBody state={modalState} onClose={onClose} />
    </Modal>
  )
}
export default React.memo(ConfigModal)
