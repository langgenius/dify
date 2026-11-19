import type { GetDatasetsData } from '@dify/contracts/api/console/datasets/types.gen'

/**
 * Availability status the Knowledge list filters on. Derived from the generated
 * list query so the filter cannot drift from the request contract.
 */
export type DatasetAvailabilityFilter = NonNullable<
  NonNullable<GetDatasetsData['query']>['availability']
>

export const DEFAULT_DATASET_AVAILABILITY: DatasetAvailabilityFilter = 'all'
