'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import NoData from './no-data'
import { useModalContext } from '@/context/modal-context'

type Props = {

}

const WebsitePreview: FC<Props> = () => {
  const { setShowAccountSettingModal } = useModalContext()

  const handleOnConfig = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  // TODO: on Hide
  return (
    <div>
      <NoData onConfig={handleOnConfig} />
    </div>
  )
}
export default React.memo(WebsitePreview)
