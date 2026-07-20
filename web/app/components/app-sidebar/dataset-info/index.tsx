'use client'
import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useKnowledge } from '@/hooks/use-knowledge'
import { DOC_FORM_TEXT } from '@/models/datasets'
import AppIcon from '../../base/app-icon'
import Dropdown from './dropdown'

type DatasetInfoProps = {
  expand: boolean
}

const DatasetInfo = ({ expand }: DatasetInfoProps) => {
  const { t } = useTranslation()
  const dataset = useDatasetDetailContextWithSelector((state) => state.dataset) as DataSet
  const iconInfo = dataset.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }
  const isExternalProvider = dataset.provider === 'external'
  const { formatIndexingTechniqueAndMethod } = useKnowledge()

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl',
        expand ? 'p-2 hover:bg-state-base-hover' : 'flex items-center justify-center px-1 py-1.5',
      )}
      aria-label={!expand ? dataset.name : undefined}
    >
      <div
        className={cn(
          expand ? 'flex w-full items-start gap-2' : 'flex items-center justify-center',
        )}
      >
        <div className="flex shrink-0 items-center">
          <AppIcon
            size="medium"
            iconType={iconInfo.icon_type}
            icon={iconInfo.icon}
            background={iconInfo.icon_background}
            imageUrl={iconInfo.icon_url}
          />
        </div>
        {expand && (
          <>
            <div className="flex min-w-0 flex-1 flex-col items-start justify-start gap-0.5">
              <div className="flex w-full min-w-0 items-center gap-2 pr-1">
                <div
                  className="min-w-0 flex-1 truncate system-md-semibold text-text-secondary"
                  title={dataset.name}
                >
                  {dataset.name}
                </div>
              </div>
              <div className="flex w-full min-w-0 items-center gap-2 system-2xs-medium-uppercase text-text-tertiary">
                {isExternalProvider && (
                  <span className="truncate">{t(($) => $.externalTag, { ns: 'dataset' })}</span>
                )}
                {!!(!isExternalProvider && dataset.doc_form && dataset.indexing_technique) && (
                  <>
                    <span className="shrink-0 truncate">
                      {t(($) => $[`chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`], {
                        ns: 'dataset',
                      })}
                    </span>
                    <span className="min-w-0 truncate">
                      {formatIndexingTechniqueAndMethod(
                        dataset.indexing_technique,
                        dataset.retrieval_model_dict?.search_method,
                      )}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex size-8 shrink-0 items-center justify-center">
              <Dropdown expand />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
export default React.memo(DatasetInfo)
