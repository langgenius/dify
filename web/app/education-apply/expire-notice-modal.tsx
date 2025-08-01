'use client'
import React from 'react'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'

type Props = {
  onClose: () => void
  onConfirm: () => void
}

const ExpireNoticeModal: React.FC<Props> = ({ onClose, onConfirm }) => {
  return (
    <Modal
      isShow
      onClose={onClose}
      title="Your education status will expire on 2025/03/14"
      closable
      className='max-w-[600px]'
    >
      Don't worry — this won't affect your current subscription, but you won't get the education discount when it renews unless you verify your status again.

Still in education?
Re-verify now to get a new coupon for the upcoming academic year. It'll be saved to your account and ready to use at your next renewal.

Already graduated?
Your current subscription will still remain active. When it ends, you'll be moved to the Sandbox plan, or you can upgrade anytime to restore full access to paid features.
      <div className="mt-4 flex justify-end space-x-2">
        <Button className="btn btn-secondary" onClick={onClose}>
          Close
        </Button>
        <Button className="btn btn-primary" onClick={onConfirm}>
          Confirm
        </Button>
      </div>
    </Modal>
  )
}

export default React.memo(ExpireNoticeModal)
