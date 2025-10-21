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
    if (Number.parseInt(value) > totalPages) {
      setInputValue(totalPages)
      onChange(totalPages - 1)
      setShowInput(false)
      return
    }
    if (Number.parseInt(value) < 1) {
      setInputValue(1)
      onChange(0)
      setShowInput(false)
      return
    }
    onChange(Number.parseInt(value) - 1)
    setInputValue(Number.parseInt(value))
    setShowInput(false)
  }, { wait: 500 })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (!value)
      return setInputValue('')
    if (isNaN(Number.parseInt(value)))
      return setInputValue('')
    setInputValue(Number.parseInt(value))
  }

  const handleInputConfirm = () => {
    if (inputValue !== '' && String(inputValue) !== String(current + 1)) {
      handlePaging(String(inputValue))
      return
    }

    if (inputValue === '')
      setInputValue(current + 1)

    setShowInput(false)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleInputConfirm()
    }
    else if (e.key === 'Escape') {
      e.preventDefault()
      setInputValue(current + 1)
      setShowInput(false)
    }
  }

  const handleInputBlur = () => {
    handleInputConfirm()
  }

  return (
    <Pagination
      className={cn('flex w-full select-none items-center px-6 py-3', className)}
      currentPage={current}
      edgePageCount={2}
      middlePagesSiblingCount={1}
      setCurrentPage={onChange}
      totalPages={totalPages}
      truncableClassName='flex items-center justify-center w-8 px-1 py-2 system-sm-medium text-text-tertiary'
      truncableText='...'
    >
      <div className='flex items-center gap-0.5 rounded-[10px] bg-background-section-burn p-0.5'>
        <Pagination.PrevButton
          as={<div></div>}
          disabled={current === 0}
        >
          <Button
            variant='secondary'
            className='h-7 w-7 px-1.5'
            disabled={current === 0}
          >
            <RiArrowLeftLine className='h-4 w-4' />
          </Button>
        </Pagination.PrevButton>
        {!showInput && (
          <div
            ref={inputRef}
            className='flex items-center gap-0.5 rounded-lg px-2 py-1.5 hover:cursor-text hover:bg-state-base-hover-alt'
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
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
          />
        )}
        <Pagination.NextButton
          as={<div></div>}
          disabled={current === totalPages - 1}
        >
          <Button
            variant='secondary'
            className='h-7 w-7 px-1.5'
            disabled={current === totalPages - 1}
          >
            <RiArrowRightLine className='h-4 w-4' />
          </Button>
        </Pagination.NextButton>
      </div>
      <div className={cn('flex grow list-none items-center justify-center gap-1')}>
        <Pagination.PageButton
          className='system-sm-medium flex min-w-8 cursor-pointer items-center justify-center rounded-lg px-1 py-2 hover:bg-components-button-ghost-bg-hover'
          activeClassName='bg-components-button-tertiary-bg text-components-button-tertiary-text hover:bg-components-button-ghost-bg-hover'
          inactiveClassName='text-text-tertiary'
        />
      </div>
      {onLimitChange && (
        <div className='flex shrink-0 items-center gap-2'>
          <div className='system-2xs-regular-uppercase w-[51px] shrink-0 text-end text-text-tertiary'>{showPerPageTip ? t('common.pagination.perPage') : ''}</div>
          <div
            className='flex items-center gap-[1px] rounded-[10px] bg-components-segmented-control-bg-normal p-0.5'
            onMouseEnter={() => setShowPerPageTip(true)}
            onMouseLeave={() => setShowPerPageTip(false)}
          >
            <div
              className={cn(
                'system-sm-medium cursor-pointer rounded-lg border-[0.5px] border-transparent px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                limit === 10 && 'border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg',
              )}
              onClick={() => onLimitChange?.(10)}
            >10</div>
            <div
              className={cn(
                'system-sm-medium cursor-pointer rounded-lg border-[0.5px] border-transparent px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                limit === 25 && 'border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg',
              )}
              onClick={() => onLimitChange?.(25)}
            >25</div>
            <div
              className={cn(
                'system-sm-medium cursor-pointer rounded-lg border-[0.5px] border-transparent px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                limit === 50 && 'border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg',
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
