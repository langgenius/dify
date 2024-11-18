import type { DataSet } from '@/models/datasets'
import { createSelectorCtx } from '@/utils/context'

const [, useDatasetDetailContext, DatasetDetailContext] = createSelectorCtx<{ indexingTechnique?: string; dataset?: DataSet; mutateDatasetRes?: () => void }>({
  defaultValue: {},
})

export { useDatasetDetailContext }

export default DatasetDetailContext
