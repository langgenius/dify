import type { RelatedAppResponse } from '@/models/datasets'
import * as React from 'react'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import ApiAccess from './api-access'
import Statistics from './statistics'

type IExtraInfoProps = {
  relatedApps?: RelatedAppResponse
  documentCount?: number
  expand: boolean
}

const ExtraInfo = ({
  relatedApps,
  documentCount,
  expand,
}: IExtraInfoProps) => {
  const apiEnabled = useDatasetDetailContextWithSelector(state => state.dataset?.enable_api)

  return (
    <>
      {expand && (
        <Statistics
          expand={expand}
          documentCount={documentCount}
          relatedApps={relatedApps}
        />
      )}
      <ApiAccess
        expand={expand}
        apiEnabled={apiEnabled ?? false}
      />
    </>
  )
}

export default React.memo(ExtraInfo)
