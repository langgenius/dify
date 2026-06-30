'use client'

import type { Button as BaseButtonNS } from '@base-ui/react/button'
import { Button as BaseButton } from '@base-ui/react/button'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import * as React from 'react'
import { cn } from '../cn'
import { useIsoLayoutEffect } from '../internals/use-iso-layout-effect'
import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
} from '../number-field'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '../segmented-control'

type PageItem = number | 'ellipsis-start' | 'ellipsis-end'

type PaginationContextValue = {
  page: number
  totalPages: number
  hasPages: boolean
  disabled: boolean
  onPageChange: (page: number) => void
  items: PageItem[]
}

const PaginationContext = React.createContext<PaginationContextValue | null>(null)

function usePaginationContext(component: string) {
  const context = React.useContext(PaginationContext)

  if (!context)
    throw new Error(`${component} must be used inside PaginationRoot.`)

  return context
}

function clampPage(page: number, totalPages: number) {
  if (!Number.isFinite(page))
    return 1

  return Math.min(Math.max(Math.trunc(page), 1), Math.max(totalPages, 1))
}

function range(start: number, end: number) {
  if (end < start)
    return []

  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

type GetPageItemsOptions = {
  page: number
  totalPages: number
  siblingCount: number
  boundaryCount: number
  visiblePageCount: number
}

function getPageItems({
  page,
  totalPages,
  siblingCount,
  boundaryCount,
  visiblePageCount,
}: GetPageItemsOptions): PageItem[] {
  if (totalPages <= 0)
    return []

  const normalizedPage = clampPage(page, totalPages)
  const normalizedBoundaryCount = Math.max(Math.trunc(boundaryCount), 1)
  const normalizedSiblingCount = Math.max(Math.trunc(siblingCount), 0)
  const windowSize = Math.max(
    Math.trunc(visiblePageCount),
    normalizedSiblingCount * 2 + 1,
  )

  if (totalPages <= windowSize + normalizedBoundaryCount)
    return range(1, totalPages)

  const nearStartEnd = windowSize
  const nearEndStart = totalPages - windowSize + 1
  const middleStart = Math.max(
    normalizedBoundaryCount + 1,
    normalizedPage - normalizedSiblingCount,
  )
  const middleEnd = Math.min(
    totalPages - normalizedBoundaryCount,
    normalizedPage + normalizedSiblingCount,
  )

  const windowPages = normalizedPage <= nearStartEnd - normalizedSiblingCount
    ? range(1, nearStartEnd)
    : normalizedPage >= nearEndStart + normalizedSiblingCount
      ? range(nearEndStart, totalPages)
      : range(middleStart, middleEnd)

  const pageSet = new Set([
    ...range(1, normalizedBoundaryCount),
    ...windowPages,
    ...range(totalPages - normalizedBoundaryCount + 1, totalPages),
  ])
  const pages = Array.from(pageSet)
    .filter(item => item >= 1 && item <= totalPages)
    .sort((a, b) => a - b)

  return pages.reduce<PageItem[]>((items, item, index) => {
    const previous = pages[index - 1]

    if (previous && item - previous === 2)
      items.push(previous + 1)
    else if (previous && item - previous > 2)
      items.push(item < normalizedPage ? 'ellipsis-start' : 'ellipsis-end')

    items.push(item)
    return items
  }, [])
}

type PaginationRootState = {
  page: number
  totalPages: number
  hasPages: boolean
  disabled: boolean
}

export type PaginationRootProps = Omit<
  useRender.ComponentProps<'nav', PaginationRootState>,
  'onChange'
> & {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  siblingCount?: number
  boundaryCount?: number
  visiblePageCount?: number
}

export function PaginationRoot({
  page,
  totalPages,
  onPageChange,
  siblingCount = 1,
  boundaryCount = 1,
  visiblePageCount = 8,
  render,
  children,
  className,
  ...props
}: PaginationRootProps) {
  const normalizedTotalPages = Math.max(Math.trunc(totalPages), 0)
  const normalizedPage = clampPage(page, normalizedTotalPages)
  const hasPages = normalizedTotalPages > 0
  const disabled = normalizedTotalPages <= 1
  const items = React.useMemo(() => getPageItems({
    page: normalizedPage,
    totalPages: normalizedTotalPages,
    siblingCount,
    boundaryCount,
    visiblePageCount,
  }), [
    boundaryCount,
    normalizedPage,
    normalizedTotalPages,
    siblingCount,
    visiblePageCount,
  ])

  const context = React.useMemo<PaginationContextValue>(() => ({
    page: normalizedPage,
    totalPages: normalizedTotalPages,
    hasPages,
    disabled,
    onPageChange: nextPage => onPageChange(clampPage(nextPage, normalizedTotalPages)),
    items,
  }), [disabled, hasPages, items, normalizedPage, normalizedTotalPages, onPageChange])

  const defaultProps: useRender.ElementProps<'nav'> = {
    'aria-label': 'Pagination',
    'className': cn('flex w-full min-w-0 items-center justify-between px-6 py-3 select-none', className),
    'children': (
      <PaginationContext.Provider value={context}>
        {children}
      </PaginationContext.Provider>
    ),
  }

  return useRender({
    defaultTagName: 'nav',
    render,
    state: {
      page: normalizedPage,
      totalPages: normalizedTotalPages,
      hasPages,
      disabled,
    },
    props: mergeProps<'nav'>(defaultProps, props),
  })
}

export type PaginationNavigationProps = useRender.ComponentProps<'div'>

export type PaginationContentProps = useRender.ComponentProps<'div'>

export function PaginationContent({
  render,
  className,
  ...props
}: PaginationContentProps) {
  const defaultProps: useRender.ElementProps<'div'> = {
    className: cn('grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2', className),
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}

export function PaginationNavigation({
  render,
  className,
  ...props
}: PaginationNavigationProps) {
  const defaultProps: useRender.ElementProps<'div'> = {
    className: cn('flex shrink-0 items-center justify-self-start gap-0.5 rounded-[10px] bg-background-section-burn p-0.5', className),
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}

type PaginationButtonProps = Omit<BaseButtonNS.Props, 'children'> & {
  children?: React.ReactNode
}

const paginationArrowButtonClassName = [
  'inline-flex size-7 shrink-0 touch-manipulation items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text shadow-xs outline-hidden backdrop-blur-[10px] transition-[background-color,border-color,color,box-shadow]',
  'hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover',
  'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
  'disabled:cursor-not-allowed disabled:border-components-button-secondary-border-disabled disabled:bg-components-button-secondary-bg-disabled disabled:text-components-button-secondary-text-disabled disabled:shadow-none',
  'motion-reduce:transition-none',
]

export function PaginationPrevious({
  className,
  children,
  'aria-label': ariaLabel,
  ...props
}: PaginationButtonProps) {
  const pagination = usePaginationContext('PaginationPrevious')

  if (!pagination.hasPages)
    return null

  const disabled = props.disabled || pagination.page <= 1 || pagination.disabled

  return (
    <BaseButton
      {...props}
      type="button"
      aria-label={ariaLabel ?? 'Previous page'}
      className={cn(paginationArrowButtonClassName, className)}
      disabled={disabled}
      onClick={(event) => {
        props.onClick?.(event)

        if (!event.defaultPrevented && !disabled)
          pagination.onPageChange(pagination.page - 1)
      }}
    >
      {children ?? <span className="i-ri-arrow-left-line size-4" aria-hidden="true" />}
    </BaseButton>
  )
}

export function PaginationNext({
  className,
  children,
  'aria-label': ariaLabel,
  ...props
}: PaginationButtonProps) {
  const pagination = usePaginationContext('PaginationNext')

  if (!pagination.hasPages)
    return null

  const disabled = props.disabled || pagination.page >= pagination.totalPages || pagination.disabled

  return (
    <BaseButton
      {...props}
      type="button"
      aria-label={ariaLabel ?? 'Next page'}
      className={cn(paginationArrowButtonClassName, className)}
      disabled={disabled}
      onClick={(event) => {
        props.onClick?.(event)

        if (!event.defaultPrevented && !disabled)
          pagination.onPageChange(pagination.page + 1)
      }}
    >
      {children ?? <span className="i-ri-arrow-right-line size-4" aria-hidden="true" />}
    </BaseButton>
  )
}

export type PaginationPageJumpProps = Omit<BaseButtonNS.Props, 'children'> & {
  inputLabel?: string
  children?: React.ReactNode
}

export function PaginationPageJump({
  className,
  inputLabel = 'Page number',
  children,
  'aria-label': ariaLabel,
  ...props
}: PaginationPageJumpProps) {
  const pagination = usePaginationContext('PaginationPageJump')
  const [editing, setEditing] = React.useState(false)
  const summaryButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const restoreSummaryFocusRef = React.useRef(false)

  useIsoLayoutEffect(() => {
    if (editing || !restoreSummaryFocusRef.current)
      return

    restoreSummaryFocusRef.current = false

    const summaryButton = summaryButtonRef.current
    if (!summaryButton)
      return

    const activeElement = summaryButton.ownerDocument.activeElement
    if (activeElement && activeElement !== summaryButton.ownerDocument.body)
      return

    summaryButton.focus({ preventScroll: true })
  }, [editing])

  if (!pagination.hasPages)
    return null

  if (editing) {
    return (
      <span
        data-page-summary={`${pagination.page}/${pagination.totalPages}`}
        className="inline-grid h-7 system-xs-medium tabular-nums after:invisible after:col-start-1 after:row-start-1 after:py-1.5 after:pe-3 after:ps-2 after:content-[attr(data-page-summary)]"
      >
        <NumberField
          key={pagination.page}
          className="col-start-1 row-start-1 w-full"
          defaultValue={pagination.page}
          min={1}
          max={Math.max(pagination.totalPages, 1)}
          onValueCommitted={(value) => {
            if (value !== null)
              pagination.onPageChange(value)

            setEditing(false)
          }}
        >
          <NumberFieldGroup
            className="h-7 w-full min-w-0 rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-active shadow-xs"
          >
            <NumberFieldInput
              aria-label={inputLabel}
              autoFocus
              className="px-2 py-1.5 text-center system-xs-medium tabular-nums"
              onBlur={() => requestAnimationFrame(() => setEditing(false))}
              onFocus={(event) => {
                const input = event.currentTarget
                requestAnimationFrame(() => input.select())
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  restoreSummaryFocusRef.current = true
                  event.currentTarget.blur()
                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  restoreSummaryFocusRef.current = true
                  setEditing(false)
                }
              }}
            />
          </NumberFieldGroup>
        </NumberField>
      </span>
    )
  }

  return (
    <BaseButton
      {...props}
      ref={summaryButtonRef}
      type="button"
      aria-label={ariaLabel ?? `Edit page number, current page ${pagination.page} of ${pagination.totalPages}`}
      className={cn(
        'inline-flex h-7 touch-manipulation items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 system-xs-medium tabular-nums text-text-secondary outline-hidden transition-colors hover:cursor-text hover:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid motion-reduce:transition-none',
        className,
      )}
      onClick={(event) => {
        props.onClick?.(event)

        if (!event.defaultPrevented)
          setEditing(true)
      }}
    >
      {children ?? (
        <React.Fragment>
          <span>{pagination.page}</span>
          <span className="text-text-quaternary">/</span>
          <span>{pagination.totalPages}</span>
        </React.Fragment>
      )}
    </BaseButton>
  )
}

export type PaginationPageListProps = useRender.ComponentProps<'ol'>

export function PaginationPageList({
  render,
  className,
  ...props
}: PaginationPageListProps) {
  const pagination = usePaginationContext('PaginationPageList')

  if (!pagination.hasPages)
    return null

  const defaultProps: useRender.ElementProps<'ol'> = {
    className: cn('col-start-2 flex min-w-0 list-none items-center justify-self-center gap-0.5', className),
    children: pagination.items.map(item => (
      <li key={item}>
        {typeof item === 'number'
          ? <PaginationPage page={item} />
          : <PaginationEllipsis />}
      </li>
    )),
  }

  return useRender({
    defaultTagName: 'ol',
    render,
    props: mergeProps<'ol'>(defaultProps, props),
  })
}

export type PaginationPageProps = Omit<BaseButtonNS.Props, 'children'> & {
  page: number
  children?: React.ReactNode
}

export function PaginationPage({
  page,
  className,
  children,
  'aria-label': ariaLabel,
  ...props
}: PaginationPageProps) {
  const pagination = usePaginationContext('PaginationPage')
  const current = page === pagination.page

  return (
    <BaseButton
      {...props}
      type="button"
      aria-current={current ? 'page' : undefined}
      aria-label={ariaLabel ?? (current ? `Page ${page}, current page` : `Go to page ${page}`)}
      className={cn(
        'inline-flex h-8 min-w-8 touch-manipulation items-center justify-center rounded-lg px-1 py-2 system-sm-medium tabular-nums text-text-tertiary outline-hidden hover:bg-components-button-ghost-bg-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        current && 'bg-components-button-tertiary-bg text-components-button-tertiary-text hover:bg-components-button-ghost-bg-hover',
        className,
      )}
      onClick={(event) => {
        props.onClick?.(event)

        if (!event.defaultPrevented)
          pagination.onPageChange(page)
      }}
    >
      {children ?? page}
    </BaseButton>
  )
}

export type PaginationEllipsisProps = useRender.ComponentProps<'span'>

export function PaginationEllipsis({
  render,
  className,
  ...props
}: PaginationEllipsisProps) {
  const defaultProps: useRender.ElementProps<'span'> = {
    'aria-hidden': true,
    'className': cn('flex size-8 items-center justify-center px-1 py-2 system-sm-medium text-text-tertiary', className),
    'children': '…',
  }

  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(defaultProps, props),
  })
}

export type PaginationPageSizeProps<Value extends number = number> = {
  'value': Value
  'options': readonly Value[]
  'onValueChange': (value: Value) => void
  'label'?: React.ReactNode
  'aria-label'?: string
  'className'?: string
}

export function PaginationPageSize<Value extends number = number>({
  value,
  options,
  onValueChange,
  label = 'Items per page',
  'aria-label': ariaLabel = 'Items per page',
  className,
}: PaginationPageSizeProps<Value>) {
  return (
    <div className={cn('group/page-size col-start-3 flex shrink-0 items-center justify-end justify-self-end gap-2', className)}>
      <div className="w-13 shrink-0 text-end system-2xs-regular-uppercase text-text-tertiary opacity-0 transition-opacity group-hover/page-size:opacity-100 group-focus-within/page-size:opacity-100 motion-reduce:transition-none">
        {label}
      </div>
      <SegmentedControl
        value={[String(value)]}
        aria-label={ariaLabel}
        onValueChange={(nextValue) => {
          const [selectedValue] = nextValue

          if (!selectedValue)
            return

          const selectedOption = options.find(option => String(option) === selectedValue)

          if (selectedOption !== undefined)
            onValueChange(selectedOption)
        }}
      >
        {options.map(option => (
          <SegmentedControlItem
            key={option}
            value={String(option)}
            className="min-w-9 data-pressed:text-text-primary"
          >
            {option}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  )
}

export type PaginationLabels = {
  previous?: string
  next?: string
  editPageNumber?: (page: number, totalPages: number) => string
  pageNumberInput?: string
}

export type PaginationPageSizeConfig<Value extends number = number> = {
  value: Value
  options: readonly Value[]
  onValueChange: (value: Value) => void
  label?: React.ReactNode
  ariaLabel?: string
}

export type PaginationProps<Value extends number = number> = Omit<PaginationRootProps, 'children'> & {
  labels?: PaginationLabels
  pageSize?: PaginationPageSizeConfig<Value>
}

export function Pagination<Value extends number = number>({
  labels,
  pageSize,
  page,
  totalPages,
  onPageChange,
  ...props
}: PaginationProps<Value>) {
  const normalizedTotalPages = Math.max(Math.trunc(totalPages), 0)
  const normalizedPage = clampPage(page, normalizedTotalPages)
  const editPageNumber = labels?.editPageNumber?.(normalizedPage, normalizedTotalPages)

  if (normalizedTotalPages <= 0)
    return null

  return (
    <PaginationRoot
      page={page}
      totalPages={totalPages}
      onPageChange={onPageChange}
      {...props}
    >
      <PaginationContent>
        <PaginationNavigation>
          <PaginationPrevious aria-label={labels?.previous} />
          <PaginationPageJump
            aria-label={editPageNumber}
            inputLabel={labels?.pageNumberInput}
          />
          <PaginationNext aria-label={labels?.next} />
        </PaginationNavigation>
        <PaginationPageList />
        {pageSize && (
          <PaginationPageSize
            value={pageSize.value}
            options={pageSize.options}
            onValueChange={pageSize.onValueChange}
            label={pageSize.label}
            aria-label={pageSize.ariaLabel}
          />
        )}
      </PaginationContent>
    </PaginationRoot>
  )
}

export type PaginationSkeletonProps = useRender.ComponentProps<'div'>

export function PaginationSkeleton({
  render,
  className,
  ...props
}: PaginationSkeletonProps) {
  const defaultProps: useRender.ElementProps<'div'> = {
    'aria-hidden': true,
    'className': cn('flex w-full min-w-0 items-center justify-between px-6 py-3 select-none', className),
    'children': (
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="flex shrink-0 items-center justify-self-start gap-0.5 rounded-[10px] bg-background-section-burn p-0.5">
          <div className="size-7 animate-pulse rounded-lg bg-state-base-hover motion-reduce:animate-none" />
          <div className="h-7 min-w-14 animate-pulse rounded-lg bg-state-base-hover motion-reduce:animate-none" />
          <div className="size-7 animate-pulse rounded-lg bg-state-base-hover motion-reduce:animate-none" />
        </div>
        <div className="col-start-2 flex items-center justify-self-center gap-0.5">
          {range(1, 8).map(item => (
            <div key={item} className="h-8 min-w-8 animate-pulse rounded-lg bg-state-base-hover motion-reduce:animate-none" />
          ))}
        </div>
        <div className="col-start-3 flex shrink-0 items-center justify-self-end">
          <div className="h-8 w-28 animate-pulse rounded-[10px] bg-state-base-hover motion-reduce:animate-none" />
        </div>
      </div>
    ),
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props),
  })
}
