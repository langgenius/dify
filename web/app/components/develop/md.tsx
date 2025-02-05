'use client'
import type { PropsWithChildren } from 'react'
import classNames from '@/utils/classnames'

type IChildrenProps = {
  children: React.ReactNode
  id?: string
  tag?: any
  label?: any
  anchor: boolean
}

type IHeaderingProps = {
  url: string
  method: 'PUT' | 'DELETE' | 'GET' | 'POST'
  title: string
  name: string
}

export const Heading = function H2({
  url,
  method,
  title,
  name,
}: IHeaderingProps) {
  let style = ''
  switch (method) {
    case 'PUT':
      style = 'ring-amber-300 bg-amber-400/10 text-amber-500 dark:ring-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400'
      break
    case 'DELETE':
      style = 'ring-rose-200 bg-rose-50 text-red-500 dark:ring-rose-500/20 dark:bg-rose-400/10 dark:text-rose-400'
      break
    case 'POST':
      style = 'ring-sky-300 bg-sky-400/10 text-sky-500 dark:ring-sky-400/30 dark:bg-sky-400/10 dark:text-sky-400'
      break
    default:
      style = 'ring-emerald-300 dark:ring-emerald-400/30 bg-emerald-400/10 text-emerald-500 dark:text-emerald-400'
      break
  }
  return (
    <>
      <span id={name?.replace(/^#/, '')} className='relative -top-28' />
      <div className="flex items-center gap-x-3" >
        <span className={`font-mono text-[0.625rem] font-semibold leading-6 rounded-lg px-1.5 ring-1 ring-inset ${style}`}>{method}</span>
        {/* <span className="h-0.5 w-0.5 rounded-full bg-zinc-300 dark:bg-zinc-600"></span> */}
        <span className="font-mono text-xs text-zinc-400">{url}</span>
      </div>
      <h2 className='mt-2 scroll-mt-32'>
        <a href={name} className='no-underline group text-inherit hover:text-inherit'>{title}</a>
      </h2>
    </>

  )
}

export function Row({ children }: IChildrenProps) {
  return (
    <div className="grid items-start grid-cols-1 gap-x-16 gap-y-10 xl:max-w-none xl:grid-cols-2">
      {children}
    </div>
  )
}

type IColProps = IChildrenProps & {
  sticky: boolean
}
export function Col({ children, sticky = false }: IColProps) {
  return (
    <div
      className={classNames(
        '[&>:first-child]:mt-0 [&>:last-child]:mb-0',
        sticky && 'xl:sticky xl:top-24',
      )}
    >
      {children}
    </div>
  )
}

export function Properties({ children }: IChildrenProps) {
  return (
    <div className="my-6">
      <ul
        role="list"
        className="m-0 max-w-[calc(theme(maxWidth.lg)-theme(spacing.8))] list-none divide-y divide-zinc-900/5 p-0 dark:divide-white/5"
      >
        {children}
      </ul>
    </div>
  )
}

type IProperty = IChildrenProps & {
  name: string
  type: string
}
export function Property({ name, type, children }: IProperty) {
  return (
    <li className="px-0 py-4 m-0 first:pt-0 last:pb-0">
      <dl className="flex flex-wrap items-center m-0 gap-x-3 gap-y-2">
        <dt className="sr-only">Name</dt>
        <dd>
          <code>{name}</code>
        </dd>
        <dt className="sr-only">Type</dt>
        <dd className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
          {type}
        </dd>
        <dt className="sr-only">Description</dt>
        <dd className="w-full flex-none [&>:first-child]:mt-0 [&>:last-child]:mb-0">
          {children}
        </dd>
      </dl>
    </li>
  )
}

type ISubProperty = IChildrenProps & {
  name: string
  type: string
}
export function SubProperty({ name, type, children }: ISubProperty) {
  return (
    <li className="px-0 py-1 m-0 last:pb-0">
      <dl className="flex flex-wrap items-center m-0 gap-x-3">
        <dt className="sr-only">Name</dt>
        <dd>
          <code>{name}</code>
        </dd>
        <dt className="sr-only">Type</dt>
        <dd className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
          {type}
        </dd>
        <dt className="sr-only">Description</dt>
        <dd className="w-full flex-none [&>:first-child]:mt-0 [&>:last-child]:mb-0">
          {children}
        </dd>
      </dl>
    </li>
  )
}

export function PropertyInstruction({ children }: PropsWithChildren<{}>) {
  return (
    <li className="m-0 px-0 py-4 first:pt-0 italic">{children}</li>
  )
}
