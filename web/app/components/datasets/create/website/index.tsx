'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import NoData from './no-data'
import Firecrawl from './firecrawl'
import { useModalContext } from '@/context/modal-context'
import type { CrawlResultItem } from '@/models/datasets'

type Props = {
  onPreview: (payload: CrawlResultItem) => void
}

const WebsitePreview: FC<Props> = ({
  onPreview,
}) => {
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
          <Firecrawl onPreview={onPreview} />
        )
        : (
          <NoData onConfig={handleOnConfig} />
        )}
    </div>
  )
}
export default React.memo(WebsitePreview)
