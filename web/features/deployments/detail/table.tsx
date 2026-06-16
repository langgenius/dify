import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type DetailTableProps = ComponentProps<'table'> & {
  containerClassName?: string
}

export function DetailTable({ className, containerClassName, ...props }: DetailTableProps) {
  return (
    <div
      data-slot="deployment-detail-table-container"
      className={cn('relative w-full pc:overflow-x-auto', containerClassName)}
    >
      <table
        data-slot="deployment-detail-table"
        className={cn('w-full max-w-full min-w-0 caption-bottom border-collapse border-0 pc:min-w-[720px]', className)}
        {...props}
      />
    </div>
  )
}

export function DetailTableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="deployment-detail-table-header"
      className={cn('system-xs-medium-uppercase text-text-tertiary [&_tr]:border-b-0 [&_tr]:hover:bg-transparent', className)}
      {...props}
    />
  )
}

export function DetailTableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="deployment-detail-table-body"
      className={cn('system-sm-regular text-text-secondary', className)}
      {...props}
    />
  )
}

export function DetailTableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="deployment-detail-table-row"
      className={cn('border-b border-divider-subtle transition-colors hover:bg-background-default-hover', className)}
      {...props}
    />
  )
}

export function DetailTableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="deployment-detail-table-head"
      className={cn('bg-background-section-burn py-1.5 pr-2 pl-3 text-left align-middle font-medium whitespace-nowrap first:rounded-l-lg last:rounded-r-lg', className)}
      {...props}
    />
  )
}

export function DetailTableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="deployment-detail-table-cell"
      className={cn('p-3 pr-2 align-middle', className)}
      {...props}
    />
  )
}

export function DetailTableCardList({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="deployment-detail-table-card-list"
      className={cn('overflow-hidden rounded-lg border border-divider-subtle bg-background-default', className)}
      {...props}
    />
  )
}

export function DetailTableCard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="deployment-detail-table-card"
      className={cn('border-b border-divider-subtle last:border-b-0 hover:bg-background-default-hover', className)}
      {...props}
    />
  )
}
