import React from 'react'
import FullScreenModal from '@/app/components/base/fullscreen-modal'
import cn from '@/utils/classnames'
import s from './style.module.css'
import { useTranslation } from 'react-i18next'
import ActionButton from '../action-button'
import Tooltip from '../tooltip'

type HTMLPreviewBtnProps = {
  content: string,
  completed?: boolean,
}

const prefixPreview = 'appOverview.overview.appInfo.preview'

type CreateIframeModalProps = {
  show: boolean,
  onClose: () => void,
  content: string,
}

const CreateIframeModal = ({ show, onClose, content }: CreateIframeModalProps) => {
  const { t } = useTranslation()
  return (
    <FullScreenModal
      overflowVisible
      closable
      open={show}
      onClose={onClose}
    >
      <iframe
        srcDoc={content}
        sandbox="allow-scripts allow-same-origin"
        title={t(`${prefixPreview}`)}
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    </FullScreenModal>
  )
}

const HTMLPreviewBtn = ({
  content,
  completed = false,
}: HTMLPreviewBtnProps) => {
  const { t } = useTranslation()
  const [show, setShow] = React.useState(false)

  const openModal = () => {
    setShow(true)
  }
  const closeModal = () => {
    setShow(false)
  }

  if (!completed) return null

  return (
    <>
      <Tooltip
        popupContent={t(`${prefixPreview}`)}>
        <ActionButton onClick={openModal}>
          <div className={cn('h-4 w-4', s.previewIcon)}></div>
        </ActionButton>
      </Tooltip>
      <CreateIframeModal
        show={show}
        onClose={closeModal}
        content={content}
      />
    </>
  )
}

export default HTMLPreviewBtn
