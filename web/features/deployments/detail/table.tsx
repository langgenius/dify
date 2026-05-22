import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type DetailTableProps = ComponentProps<'table'> & {
  containerClassName?: string
}

export function DetailTable({ className, containerClassName, ...props }: DetailTableProps) {
  return (
    <div
      data-slot="deployment-detail-table-container"
      className={cn('relative w-full overflow-x-auto', containerClassName)}
    >
      <table
        data-slot="deployment-detail-table"
        className={cn('w-full max-w-full min-w-[700px] caption-bottom border-collapse border-0 text-sm', className)}
        {...props}
      />
    </div>
  )
}

export function DetailTableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="deployment-detail-table-header"
      className={cn('h-8 border-b border-divider-subtle text-xs/8 font-medium text-text-tertiary uppercase', className)}
      {...props}
    />
  )
}

export function DetailTableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="deployment-detail-table-body"
      className={cn('text-text-secondary', className)}
      {...props}
    />
  )
}

export function DetailTableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="deployment-detail-table-row"
      className={cn('h-8 border-b border-divider-subtle transition-colors hover:bg-background-default-hover', className)}
      {...props}
    />
  )
}

export function DetailTableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="deployment-detail-table-head"
      className={cn('max-w-[200px] px-2.5 py-0 pl-3 text-left align-middle font-medium whitespace-nowrap text-text-tertiary', className)}
      {...props}
    />
  )
}

export function DetailTableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="deployment-detail-table-cell"
      className={cn('max-w-[200px] px-2.5 py-[5px] pl-3 align-middle', className)}
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
