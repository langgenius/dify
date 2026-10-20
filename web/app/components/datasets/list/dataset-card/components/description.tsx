import type { DatasetDetailWithPartialMembersResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { isDatasetAvailable } from '../availability'

type DescriptionProps = {
  dataset: DatasetDetailWithPartialMembersResponse
}

const Description = ({ dataset }: DescriptionProps) => (
  <div
    className={cn(
      'line-clamp-2 h-10 px-4 py-1 system-xs-regular text-text-tertiary',
      !isDatasetAvailable(dataset) && 'opacity-30',
    )}
    title={dataset.description ?? undefined}
  >
    {dataset.description}
  </div>
)

export default React.memo(Description)
