'use client'
import type { FC } from 'react'
import {
  RiLoader2Line,
  RiPlayLargeLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { cn } from '@/utils/classnames'
import CSVDownload from './csv-download'
import CSVReader from './csv-reader'

export type IRunBatchProps = {
  vars: { name: string }[]
  onSend: (data: string[][]) => void
  isAllFinished: boolean
}

const RunBatch: FC<IRunBatchProps> = ({
  vars,
  onSend,
  isAllFinished,
}) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc

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
  const Icon = isAllFinished ? RiPlayLargeLine : RiLoader2Line
  return (
    <div className="pt-4">
      <CSVReader onParsed={handleParsed} />
      <CSVDownload vars={vars} />
      <div className="flex justify-end">
        <Button
          variant="primary"
          className={cn('mt-4 pl-3 pr-4', !isPC && 'grow')}
          onClick={handleSend}
          disabled={!isParsed || !isAllFinished}
        >
          <Icon className={cn(!isAllFinished && 'animate-spin', 'mr-1 h-4 w-4 shrink-0')} aria-hidden="true" />
          <span className="text-[13px] uppercase">{t('generation.run', { ns: 'share' })}</span>
        </Button>
      </div>
    </div>
  )
}
export default React.memo(RunBatch)
