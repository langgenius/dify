'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import NoData from './no-data'
import Firecrawl from './firecrawl'
import { useModalContext } from '@/context/modal-context'

type Props = {

}

const WebsitePreview: FC<Props> = () => {
  const { setShowAccountSettingModal } = useModalContext()
  const [isLoaded, setIsLoaded] = useState(false)
  const [isConfigured, setIsConfigured] = useState(true)

  const handleOnConfig = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  // TODO: on Hide account setting modal

  if (isLoaded)
    return null

  return (
    <div>
      {isConfigured
        ? (
          <Firecrawl />
        )
        : (
          <NoData onConfig={handleOnConfig} />
        )}
    </div>
  )
}
export default React.memo(WebsitePreview)
