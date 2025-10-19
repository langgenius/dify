import { useCallback, useState } from 'react'
import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import DataSource from './data-source'
import Divider from '@/app/components/base/divider'
import ProcessDocuments from './process-documents'
import type { Datasource } from '../../test-run/types'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'
import cn from '@/utils/classnames'
import { useFloatingRight } from '../hooks'

const PreviewPanel = () => {
  const { t } = useTranslation()
  const [datasource, setDatasource] = useState<Datasource>()
  const { toggleInputFieldPreviewPanel } = useInputFieldPanel()

  const { floatingRight, floatingRightWidth } = useFloatingRight(480)

  const handleClosePreviewPanel = useCallback(() => {
    toggleInputFieldPreviewPanel()
  }, [toggleInputFieldPreviewPanel])

  return (
    <div
      className={cn(
        'mr-1 flex h-full flex-col overflow-y-auto rounded-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5',
        'transition-all duration-300 ease-in-out',
        floatingRight && 'absolute right-0 z-[100]',
      )}
      style={{
        width: `${floatingRightWidth}px`,
      }}
    >
      <div className='flex items-center gap-x-2 px-4 pt-1'>
        <div className='grow py-1'>
          <Badge className='border-text-accent-secondary bg-components-badge-bg-dimm text-text-accent-secondary'>
            {t('datasetPipeline.operations.preview')}
          </Badge>
        </div>
        <button
          type='button'
          className='flex size-6 shrink-0 items-center justify-center'
          onClick={handleClosePreviewPanel}
        >
          <RiCloseLine className='size-4 text-text-tertiary' />
        </button>
      </div>
      {/* Data source form Preview */}
      <DataSource
        onSelect={setDatasource}
        dataSourceNodeId={datasource?.nodeId || ''}
      />
      <div className='px-4 py-2'>
        <Divider type='horizontal' className='bg-divider-subtle' />
      </div>
      {/* Process documents form Preview */}
      <ProcessDocuments dataSourceNodeId={datasource?.nodeId || ''} />
    </div>
  )
}

export default PreviewPanel
