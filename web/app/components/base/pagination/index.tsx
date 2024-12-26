import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowLeftLine, RiArrowRightLine } from '@remixicon/react'
import { useDebounceFn } from 'ahooks'
import { Pagination } from './pagination'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import cn from '@/utils/classnames'

export type Props = {
  className?: string
  current: number
  onChange: (cur: number) => void
  total: number
  limit?: number
  onLimitChange?: (limit: number) => void
}

const CustomizedPagination: FC<Props> = ({
  className,
  current,
  onChange,
  total,
  limit = 10,
  onLimitChange,
}) => {
  const { t } = useTranslation()
  const totalPages = Math.ceil(total / limit)
  const inputRef = React.useRef<HTMLDivElement>(null)
  const [showInput, setShowInput] = React.useState(false)
  const [inputValue, setInputValue] = React.useState<string | number>(current + 1)
  const [showPerPageTip, setShowPerPageTip] = React.useState(false)

  const { run: handlePaging } = useDebounceFn((value: string) => {
    if (parseInt(value) > totalPages) {
      setInputValue(totalPages)
      onChange(totalPages - 1)
      setShowInput(false)
      return
    }
    if (parseInt(value) < 1) {
      setInputValue(1)
      onChange(0)
      setShowInput(false)
      return
    }
    onChange(parseInt(value) - 1)
    setInputValue(parseInt(value))
    setShowInput(false)
  }, { wait: 500 })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (!value)
      return setInputValue('')
    if (isNaN(parseInt(value)))
      return setInputValue('')
    setInputValue(parseInt(value))
    handlePaging(value)
  }

  return (
    <Pagination
      className={cn('flex items-center w-full px-6 py-3 select-none', className)}
      currentPage={current}
      edgePageCount={2}
      middlePagesSiblingCount={1}
      setCurrentPage={onChange}
      totalPages={totalPages}
      truncableClassName='flex items-center justify-center w-8 px-1 py-2 system-sm-medium text-text-tertiary'
      truncableText='...'
    >
      <div className='flex items-center gap-0.5 p-0.5 rounded-[10px] bg-background-section-burn'>
        <Pagination.PrevButton
          as={<div></div>}
          disabled={current === 0}
        >
          <Button
            variant='secondary'
            className='w-7 h-7 px-1.5'
            disabled={current === 0}
          >
            <RiArrowLeftLine className='h-4 w-4' />
          </Button>
        </Pagination.PrevButton>
        {!showInput && (
          <div
            ref={inputRef}
            className='flex items-center gap-0.5 px-2 py-1.5 rounded-lg hover:bg-state-base-hover-alt hover:cursor-text'
            onClick={() => setShowInput(true)}
          >
            <div className='system-xs-medium text-text-secondary'>{current + 1}</div>
            <div className='system-xs-medium text-text-quaternary'>/</div>
            <div className='system-xs-medium text-text-secondary'>{totalPages}</div>
          </div>
        )}
        {showInput && (
          <Input
            styleCss={{
              height: '28px',
              width: `${inputRef.current?.clientWidth}px`,
            }}
            placeholder=''
            autoFocus
            value={inputValue}
            onChange={handleInputChange}
            onBlur={() => setShowInput(false)}
          />
        )}
        <Pagination.NextButton
          as={<div></div>}
          disabled={current === totalPages - 1}
        >
          <Button
            variant='secondary'
            className='w-7 h-7 px-1.5'
            disabled={current === totalPages - 1}
          >
            <RiArrowRightLine className='h-4 w-4' />
          </Button>
        </Pagination.NextButton>
      </div>
      <div className={cn('grow flex items-center justify-center gap-1 list-none')}>
        <Pagination.PageButton
          className='flex items-center justify-center min-w-8 px-1 py-2 rounded-lg system-sm-medium cursor-pointer hover:bg-components-button-ghost-bg-hover'
          activeClassName='bg-components-button-tertiary-bg text-components-button-tertiary-text hover:bg-components-button-ghost-bg-hover'
          inactiveClassName='text-text-tertiary'
        />
      </div>
      {onLimitChange && (
        <div className='shrink-0 flex items-center gap-2'>
          <div className='shrink-0 w-[51px] text-end text-text-tertiary system-2xs-regular-uppercase'>{showPerPageTip ? t('common.pagination.perPage') : ''}</div>
          <div
            className='flex items-center gap-[1px] p-0.5 rounded-[10px] bg-components-segmented-control-bg-normal'
            onMouseEnter={() => setShowPerPageTip(true)}
            onMouseLeave={() => setShowPerPageTip(false)}
          >
            <div
              className={cn(
                'px-2.5 py-1.5 rounded-lg border-[0.5px] border-transparent system-sm-medium text-text-tertiary cursor-pointer hover:bg-state-base-hover hover:text-text-secondary',
                limit === 10 && 'shadow-xs border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-secondary hover:bg-components-segmented-control-item-active-bg',
              )}
              onClick={() => onLimitChange?.(10)}
            >10</div>
            <div
              className={cn(
                'px-2.5 py-1.5 rounded-lg border-[0.5px] border-transparent system-sm-medium text-text-tertiary cursor-pointer hover:bg-state-base-hover hover:text-text-secondary',
                limit === 25 && 'shadow-xs border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-secondary hover:bg-components-segmented-control-item-active-bg',
              )}
              onClick={() => onLimitChange?.(25)}
            >25</div>
            <div
              className={cn(
                'px-2.5 py-1.5 rounded-lg border-[0.5px] border-transparent system-sm-medium text-text-tertiary cursor-pointer hover:bg-state-base-hover hover:text-text-secondary',
                limit === 50 && 'shadow-xs border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-secondary hover:bg-components-segmented-control-item-active-bg',
              )}
              onClick={() => onLimitChange?.(50)}
            >50</div>
          </div>
        </div>
      )}
    </Pagination>
  )
}

export default CustomizedPagination
