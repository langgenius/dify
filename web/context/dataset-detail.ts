import type { DataSet } from '@/models/datasets'

const [, useDatasetDetailContext, DatasetDetailContext] = createSelectorCtx<{ indexingTechnique?: string; dataset?: DataSet; mutateDatasetRes?: () => void }>({
  defaultValue: {},
})

export default DatasetDetailContext
