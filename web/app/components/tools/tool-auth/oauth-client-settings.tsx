import { memo } from 'react'
import Modal from '@/app/components/base/modal/modal'

type OAuthClientSettingsProps = {
  onClose?: () => void
}
const OAuthClientSettings = ({
  onClose,
}: OAuthClientSettingsProps) => {
  return (
    <Modal
      title='Oauth client settings'
      confirmButtonText='Save & Authorize'
      cancelButtonText='Save only'
      extraButtonText='Cancel'
      showExtraButton
      extraButtonVariant='secondary'
      onExtraButtonClick={onClose}
      onClose={onClose}
    >
      <div>oauth</div>
    </Modal>
  )
}

export default memo(OAuthClientSettings)
