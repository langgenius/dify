import type { SiteInfo } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import Modal from '@/app/components/base/modal'
import { appDefaultIconBackground } from '@/config'

type Props = {
  data?: SiteInfo
  isShow: boolean
  onClose: () => void
}

const InfoModal = ({
  isShow,
  onClose,
  data,
}: Props) => {
  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className="max-w-[400px] min-w-[400px] p-0!"
      closable
    >
      <div className={cn('flex flex-col items-center gap-4 px-4 pt-10 pb-8')}>
        <AppIcon
          size="xxl"
          iconType={data?.icon_type}
          icon={data?.icon}
          background={data?.icon_background || appDefaultIconBackground}
          imageUrl={data?.icon_url}
        />
        <div className="system-xl-semibold text-text-secondary">{data?.title}</div>
        <div className="system-xs-regular text-text-tertiary">
          {/* copyright */}
          {data?.copyright && (
            <div>
              ©
              {(new Date()).getFullYear()}
              {' '}
              {data?.copyright}
            </div>
          )}
          {data?.custom_disclaimer && (
            <div className="mt-2">{data.custom_disclaimer}</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default InfoModal
