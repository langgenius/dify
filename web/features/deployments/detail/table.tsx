import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type DetailTableProps = ComponentProps<'table'> & {
  containerClassName?: string
}

export function DetailTable({ className, containerClassName, ...props }: DetailTableProps) {
  return (
    <div
      data-slot="deployment-detail-table-container"
      className={cn('overflow-hidden rounded-lg border border-divider-subtle bg-background-default', containerClassName)}
    >
      <table
        data-slot="deployment-detail-table"
        className={cn('w-full table-fixed caption-bottom border-collapse bg-background-default', className)}
        {...props}
      />
    </div>
  )
}

export function DetailTableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="deployment-detail-table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

export function DetailTableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="deployment-detail-table-body"
      className={cn('[&_tr:last-child]:border-b-0', className)}
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
      className={cn('h-9 px-4 py-2 text-left align-middle system-sm-medium-uppercase whitespace-nowrap text-text-tertiary', className)}
      {...props}
    />
  )
}

export function DetailTableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="deployment-detail-table-cell"
      className={cn('h-12 min-w-0 px-4 py-2 align-middle', className)}
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
