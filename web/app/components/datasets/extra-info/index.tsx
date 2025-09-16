import React from 'react'
import type { RelatedAppResponse } from '@/models/datasets'
import Statistics from './statistics'
import ServiceApi from './service-api'
import { useDatasetApiBaseUrl } from '@/service/knowledge/use-dataset'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'

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
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()

  return (
    <>
      {expand && (
        <Statistics
          expand={expand}
          documentCount={documentCount}
          relatedApps={relatedApps}
        />
      )}
      <ServiceApi
        expand={expand}
        apiBaseUrl={apiBaseInfo?.api_base_url ?? ''}
        apiEnabled={apiEnabled ?? false}
      />
    </>
  )
}

export default React.memo(ExtraInfo)
