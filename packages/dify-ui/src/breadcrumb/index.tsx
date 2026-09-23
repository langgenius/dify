'use client'

import type * as React from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cn } from '../cn'

type BreadcrumbName =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-label'?: never; 'aria-labelledby': string }

type BreadcrumbProps = Omit<React.ComponentProps<'nav'>, 'aria-label' | 'aria-labelledby'> &
  BreadcrumbName
type BreadcrumbListProps = React.ComponentProps<'ol'>
type BreadcrumbItemProps = React.ComponentProps<'li'>
type BreadcrumbLinkProps = useRender.ComponentProps<'a'>
type BreadcrumbPageProps = React.ComponentProps<'span'>
type BreadcrumbSeparatorProps = React.ComponentProps<'li'>

function Breadcrumb({ className, ...props }: BreadcrumbProps) {
  return <nav className={cn('min-w-0', className)} {...props} />
}

function BreadcrumbList({ className, ...props }: BreadcrumbListProps) {
  return (
    <ol
      className={cn(
        'flex min-w-0 items-center gap-1.5 system-sm-regular text-text-secondary',
        className,
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({ className, ...props }: BreadcrumbItemProps) {
  return <li className={cn('flex min-w-0 items-center gap-1.5', className)} {...props} />
}

function BreadcrumbLink({ className, render, ...props }: BreadcrumbLinkProps) {
  return useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>(
      {
        className: cn(
          'inline-flex min-w-0 items-center gap-1 rounded-sm whitespace-nowrap text-text-tertiary hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden aria-[current=page]:text-text-primary',
          className,
        ),
      },
      props,
    ),
  })
}

function BreadcrumbPage({ className, ...props }: BreadcrumbPageProps) {
  return (
    <span
      aria-current="page"
      className={cn('min-w-0 whitespace-nowrap text-text-primary', className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({ children = '/', className, ...props }: BreadcrumbSeparatorProps) {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center text-text-quaternary select-none',
        className,
      )}
      {...props}
    >
      {children}
    </li>
  )
}

export {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
}
export type {
  BreadcrumbItemProps,
  BreadcrumbLinkProps,
  BreadcrumbListProps,
  BreadcrumbPageProps,
  BreadcrumbProps,
  BreadcrumbSeparatorProps,
}
