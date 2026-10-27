import type { DatasetCardItem } from '../types'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { downloadBlob } from '@/utils/download'

type UseDatasetCardActionsOptions = {
  dataset: DatasetCardItem
}

export const useDatasetCardActions = ({ dataset }: UseDatasetCardActionsOptions) => {
  const { t } = useTranslation(['app'])
  const { push } = useRouter()

  const openAccessConfig = useCallback(() => {
    push(`/datasets/${dataset.id}/access-config`)
  }, [dataset.id, push])

  const { mutateAsync: exportPipelineConfig, isPending: exporting } = useMutation(
    consoleQuery.rag.pipelines.byPipelineId.exports.get.mutationOptions(),
  )

  const handleExportPipeline = useCallback(
    async (include: boolean = false) => {
      const { pipeline_id, name } = dataset
      if (!pipeline_id || exporting) return

      try {
        const { data } = await exportPipelineConfig({
          params: { pipeline_id },
          query: { include_secret: String(include) },
        })
        const file = new Blob([data], { type: 'application/yaml' })
        downloadBlob({ data: file, fileName: `${name}.pipeline` })
      } catch {
        toast.error(t(($) => $.exportFailed, { ns: 'app' }))
      }
    },
    [dataset, exportPipelineConfig, exporting, t],
  )

  return { openAccessConfig, handleExportPipeline }
}
