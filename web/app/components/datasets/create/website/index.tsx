'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import NoData from './no-data'

type Props = {

}

const WebsitePreview: FC<Props> = () => {
  const handleOnConfig = useCallback(() => { }, [])
  return (
    <div>
      <NoData onConfig={handleOnConfig} />
    </div>
  )
}
export default React.memo(WebsitePreview)
