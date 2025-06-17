import { useState } from 'react'
import { RiCloseLine } from '@remixicon/react'
import DialogWrapper from '../dialog-wrapper'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import DataSource from './data-source'
import Divider from '@/app/components/base/divider'
import ProcessDocuments from './process-documents'
import type { Datasource } from '../../panel/test-run/types'

type PreviewPanelProps = {
  show: boolean
  onClose: () => void
}

const PreviewPanel = ({
  show,
  onClose,
}: PreviewPanelProps) => {
  const { t } = useTranslation()
  const [datasource, setDatasource] = useState<Datasource>()

  return (
    <DialogWrapper
      show={show}
      onClose={onClose}
      panelWrapperClassName='pr-[424px] justify-start'
      className='w-[480px] grow rounded-2xl border-[0.5px] bg-components-panel-bg'
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
          onClick={onClose}
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
    </DialogWrapper>
  )
}

export default PreviewPanel
