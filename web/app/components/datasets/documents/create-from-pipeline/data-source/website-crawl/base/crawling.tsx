'use client'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type CrawlingProps = {
  className?: string
  crawledNum: number
  totalNum: number
}

type BlockProps = {
  className?: string
}

type ItemProps = {
  firstLineWidth: string
  secondLineWidth: string
}

const Block = React.memo(({
  className,
}: BlockProps) => {
  return <div className={cn('bg-text-quaternary opacity-20', className)} />
})

const Item = React.memo(({
  firstLineWidth,
  secondLineWidth,
}: ItemProps) => {
  return (
    <div className="flex gap-x-2 px-2 py-[5px]">
      <div className="py-0.5">
        <Block className="size-4 rounded-[4px]" />
      </div>
      <div className="flex grow flex-col">
        <div className="flex h-5 w-full items-center">
          <Block className={cn('h-2.5 rounded-sm', firstLineWidth)} />
        </div>
        <div className="flex h-[18px] w-full items-center">
          <Block className={cn('h-1.5 rounded-sm', secondLineWidth)} />
        </div>
      </div>
    </div>
  )
})

const Crawling = ({
  className = '',
  crawledNum,
  totalNum,
}: CrawlingProps) => {
  const { t } = useTranslation()

  const itemsConfig = [{
    firstLineWidth: 'w-[35%]',
    secondLineWidth: 'w-[50%]',
  }, {
    firstLineWidth: 'w-[40%]',
    secondLineWidth: 'w-[45%]',
  }, {
    firstLineWidth: 'w-[30%]',
    secondLineWidth: 'w-[36%]',
  }]

  return (
    <div className={cn('mt-2 flex flex-col gap-y-2 pt-2', className)}>
      <div className="system-sm-medium text-text-primary">
        {t('stepOne.website.totalPageScraped', { ns: 'datasetCreation' })}
        {' '}
        {crawledNum}
        /
        {totalNum}
      </div>
      <div className="overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg">
        <div className="flex items-center gap-x-2 px-4 py-2">
          <Block className="size-4 rounded-[4px]" />
          <Block className="h-2.5 w-14 rounded-sm" />
        </div>
        <div className="flex flex-col gap-px border-t border-divider-subtle bg-background-default-subtle p-2">
          {itemsConfig.map((item, index) => (
            <Item
              key={index}
              firstLineWidth={item.firstLineWidth}
              secondLineWidth={item.secondLineWidth}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
export default React.memo(Crawling)
