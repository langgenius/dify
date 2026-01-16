import { useMutation } from '@tanstack/react-query'
import { checkIsUsedInApp, deleteDataset } from './datasets'

const NAME_SPACE = 'dataset-card'

export const useCheckDatasetUsage = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'check-usage'],
    mutationFn: (datasetId: string) => checkIsUsedInApp(datasetId),
  })
}

export const useDeleteDataset = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: (datasetId: string) => deleteDataset(datasetId),
  })
}
