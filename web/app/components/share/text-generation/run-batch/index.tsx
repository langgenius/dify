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
  onSend: (data: string[][]) => void
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
    // console.log(data)
    setIsParsed(true)
  }

  const handleSend = () => {
    onSend(csvData)
  }
  return (
    <div className='pt-4'>
      <CSVReader onParsed={handleParsed} />
      <CSVDownload vars={vars} />
      <div className='mt-4 h-[1px] bg-gray-100'></div>
      <div className='flex justify-end'>
        <Button
          type="primary"
          className='mt-4 !h-8 !pl-3 !pr-4'
          onClick={handleSend}
          disabled={!isParsed}
        >
          <PlayIcon className="shrink-0 w-4 h-4 mr-1" aria-hidden="true" />
          <span className='uppercase text-[13px]'>{t('share.generation.run')}</span>
        </Button>
      </div>
    </div>
  )
}
export default React.memo(RunBatch)
