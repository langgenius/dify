import { RiAddCircleLine } from '@remixicon/react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Toast from '@/app/components/base/toast'
import { useCreatePipelineDataset } from '@/service/knowledge/use-create-dataset'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'

const CreateCard = () => {
  const { t } = useTranslation()
  const { push } = useRouter()

  const { mutateAsync: createEmptyDataset } = useCreatePipelineDataset()
  const invalidDatasetList = useInvalidDatasetList()

  const handleCreate = useCallback(async () => {
    await createEmptyDataset(undefined, {
      onSuccess: (data) => {
        if (data) {
          const { id } = data
          Toast.notify({
            type: 'success',
            message: t('creation.successTip', { ns: 'datasetPipeline' }),
          })
          invalidDatasetList()
          trackEvent('create_datasets_from_scratch', {
            dataset_id: id,
          })
          push(`/datasets/${id}/pipeline`)
        }
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('creation.errorTip', { ns: 'datasetPipeline' }),
        })
      },
    })
  }, [createEmptyDataset, push, invalidDatasetList, t])

  return (
    <div
      className="group relative flex h-[132px] cursor-pointer flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs shadow-shadow-shadow-3"
      onClick={handleCreate}
    >
      <div className="flex items-center gap-x-3 p-4 pb-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-divider-regular bg-background-section group-hover:border-state-accent-hover-alt group-hover:bg-state-accent-hover">
          <RiAddCircleLine className="size-5 text-text-quaternary group-hover:text-text-accent" />
        </div>
        <div className="system-md-semibold truncate text-text-primary">
          {t('creation.createFromScratch.title', { ns: 'datasetPipeline' })}
        </div>
      </div>
      <p className="system-xs-regular line-clamp-3 px-4 py-1 text-text-tertiary">
        {t('creation.createFromScratch.description', { ns: 'datasetPipeline' })}
      </p>
    </div>
  )
}

export default React.memo(CreateCard)
