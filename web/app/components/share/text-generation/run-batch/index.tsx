'use client'
import type { FC } from 'react'
import React from 'react'
import {
  PlayIcon,
} from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'
import CSVReader from './csv-reader'
import CSVDownload from './csv-download'
import Button from '@/app/components/base/button'

export type IRunBatchProps = {
  vars: { name: string }[]
  onSend: () => void
}

const RunBatch: FC<IRunBatchProps> = ({
  vars,
  onSend,
}) => {
  const { t } = useTranslation()

  const [csvData, setCsvData] = React.useState<string[][]>([])
  const [isParsed, setIsParsed] = React.useState(false)
  const handleParsed = (data: string[][]) => {
    setCsvData(data)
    console.log(data)
    setIsParsed(true)
  }
  return (
    <div>
      <CSVReader onParsed={handleParsed} />
      <CSVDownload vars={vars} />

      <Button
        type="primary"
        className='w-[80px] !h-8 !p-0'
        onClick={onSend}
        disabled={!isParsed}
      >
        <PlayIcon className="shrink-0 w-4 h-4 mr-1" aria-hidden="true" />
        <span className='uppercase text-[13px]'>{t('share.generation.run')}</span>
      </Button>
    </div>
  )
}
export default React.memo(RunBatch)
