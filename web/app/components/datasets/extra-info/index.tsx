import type { RelatedAppResponse } from '@/models/datasets'
import * as React from 'react'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDatasetApiBaseUrl } from '@/service/knowledge/use-dataset'
import ServiceApi from './service-api'
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
