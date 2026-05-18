'use client'
import type { PropsWithChildren, ReactElement, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from '@langgenius/dify-ui/tabs'
import {
  Children,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { writeTextToClipboard } from '@/utils/clipboard'
import { Tag } from './tag'

type IChildrenProps = {
  children: React.ReactNode
  [key: string]: any
}

function ClipboardIcon(props: any) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" {...props}>
      <path
        strokeWidth="0"
        d="M5.5 13.5v-5a2 2 0 0 1 2-2l.447-.894A2 2 0 0 1 9.737 4.5h.527a2 2 0 0 1 1.789 1.106l.447.894a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2Z"
      />
      <path
        fill="none"
        strokeLinejoin="round"
        d="M12.5 6.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2m5 0-.447-.894a2 2 0 0 0-1.79-1.106h-.527a2 2 0 0 0-1.789 1.106L7.5 6.5m5 0-1 1h-3l-1-1"
      />
    </svg>
  )
}

function CopyButton({ code }: { code: string }) {
  const [copyCount, setCopyCount] = useState(0)
  const copied = copyCount > 0

  useEffect(() => {
    if (copyCount > 0) {
      const timeout = setTimeout(() => setCopyCount(0), 1000)
      return () => {
        clearTimeout(timeout)
      }
    }
  }, [copyCount])

  return (
    <button
      type="button"
      className={cn('group/button absolute top-1.5 right-4 overflow-hidden rounded-full py-1 pr-3 pl-2 text-2xs font-medium opacity-0 backdrop-blur-sm transition group-hover:opacity-100 focus:opacity-100', copied
        ? 'bg-emerald-400/10 ring-1 ring-emerald-400/20 ring-inset'
        : 'bg-white/5 hover:bg-white/7.5 dark:bg-white/2.5 dark:hover:bg-white/5')}
      onClick={() => {
        writeTextToClipboard(code).then(() => {
          setCopyCount(count => count + 1)
        })
      }}
    >
      <span
        aria-hidden={copied}
        className={cn('pointer-events-none flex items-center gap-0.5 text-zinc-400 transition duration-300', copied && '-translate-y-1.5 opacity-0')}
      >
        <ClipboardIcon className="h-5 w-5 fill-zinc-500/20 stroke-zinc-500 transition-colors group-hover/button:stroke-zinc-400" />
        Copy
      </span>
      <span
        aria-hidden={!copied}
        className={cn('pointer-events-none absolute inset-0 flex items-center justify-center text-emerald-400 transition duration-300', !copied && 'translate-y-1.5 opacity-0')}
      >
        Copied!
      </span>
    </button>
  )
}

function CodePanelHeader({ tag, label }: { tag?: string, label?: string }) {
  if (!tag && !label)
    return null

  return (
    <div className="flex h-9 items-center gap-2 border-y border-t-transparent border-b-white/7.5 bg-white/2.5 bg-zinc-900 px-4 dark:border-b-white/5 dark:bg-white/1">
      {tag && (
        <div className="dark flex">
          <Tag variant="small">{tag}</Tag>
        </div>
      )}
      {tag && label && (
        <span className="h-0.5 w-0.5 rounded-full bg-zinc-500" />
      )}
      {label && (
        <span className="font-mono text-xs text-zinc-400">{label}</span>
      )}
    </div>
  )
}

type CodeExample = {
  title?: string
  tag?: string
  code: string
}

type CodeTab = {
  title: string
  value: string
}

type ICodePanelProps = {
  children?: React.ReactNode
  tag?: string
  label?: string
  code?: string
  title?: string
  targetCode?: CodeExample
}

function CodePanel({ tag, label, children, targetCode }: ICodePanelProps) {
  const child = Children.toArray(children)[0] as ReactElement<any>

  return (
    <div className="group dark:bg-white/2.5">
      <CodePanelHeader
        tag={tag}
        label={label}
      />
      <div className="relative">
        {/* <pre className="p-4 overflow-x-auto text-xs text-white">{children}</pre> */}
        {/* <CopyButton code={child.props.code ?? code} /> */}
        {/* <CopyButton code={child.props.children.props.children} /> */}
        <pre className="overflow-x-auto p-4 text-xs text-white">
          {targetCode?.code
            ? (
                <code>{targetCode?.code}</code>
              )
            : (
                child
              )}
        </pre>
        <CopyButton code={targetCode?.code ?? child.props.children.props.children} />
      </div>
    </div>
  )
}

type CodeGroupHeaderProps = {
  title?: string
  tabs?: CodeTab[]
}

function CodeGroupHeader({ title, tabs }: CodeGroupHeaderProps) {
  const hasTabs = (tabs?.length ?? 0) > 1

  return (
    <div className="flex min-h-[calc(--spacing(12)+1px)] flex-wrap items-start gap-x-4 border-b border-zinc-700 bg-zinc-800 px-4 dark:border-zinc-800 dark:bg-transparent">
      {title && (
        <h3 className="mr-auto pt-3 text-xs font-semibold text-white">
          {title}
        </h3>
      )}
      {hasTabs && (
        <TabsList
          className="-mb-px flex gap-4 rounded-none bg-transparent p-0 text-xs font-medium"
        >
          {tabs!.map(tab => (
            <TabsTab
              key={tab.value}
              value={tab.value}
              className="h-auto rounded-none border-0 border-b border-transparent bg-transparent px-0 py-3 text-xs font-medium text-zinc-400 shadow-none transition hover:bg-transparent hover:text-zinc-300 focus:not-focus-visible:outline-hidden focus-visible:ring-0 data-active:border-emerald-500 data-active:bg-transparent data-active:text-emerald-400 data-active:shadow-none"
            >
              {tab.title}
            </TabsTab>
          ))}
        </TabsList>
      )}
    </div>
  )
}

type ICodeGroupPanelsProps = PropsWithChildren<{
  targetCode?: CodeExample[]
  tabs?: CodeTab[]
  [key: string]: any
}>

function CodeGroupPanels({ children, targetCode, tabs, ...props }: ICodeGroupPanelsProps) {
  if ((targetCode?.length ?? 0) > 1 && tabs) {
    return (
      <>
        {targetCode!.map((code, index) => {
          const tab = tabs[index]

          return (
            <TabsPanel key={code.title || code.tag || index} value={tab?.value ?? String(index)}>
              <CodePanel {...props} targetCode={code} />
            </TabsPanel>
          )
        })}
      </>
    )
  }

  return <CodePanel {...props} targetCode={targetCode?.[0]}>{children}</CodePanel>
}

function usePreventLayoutShift() {
  const positionRef = useRef<any>(null)
  const rafRef = useRef<any>(null)

  useEffect(() => {
    return () => {
      if (rafRef.current)
        window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return {
    positionRef,
    preventLayoutShift(callback: () => void) {
      if (!positionRef.current) {
        callback()
        return
      }

      const initialTop = positionRef.current.getBoundingClientRect().top

      callback()

      rafRef.current = window.requestAnimationFrame(() => {
        if (!positionRef.current)
          return

        const newTop = positionRef.current.getBoundingClientRect().top
        window.scrollBy(0, newTop - initialTop)
      })
    },
  }
}

function useTabGroupProps(tabValues: string[]) {
  const [selectedValue, setSelectedValue] = useState(tabValues[0] ?? '')
  const { positionRef, preventLayoutShift } = usePreventLayoutShift()
  const value = tabValues.includes(selectedValue)
    ? selectedValue
    : tabValues[0] ?? ''

  return {
    ref: positionRef,
    value,
    onValueChange: (newValue: string | number | null) => {
      if (newValue == null)
        return

      const nextValue = String(newValue)
      if (!tabValues.includes(nextValue))
        return

      preventLayoutShift(() => {
        setSelectedValue(nextValue)
      })
    },
  }
}

const CodeGroupContext = createContext(false)

type CodeGroupProps = PropsWithChildren<{
  /** Code example(s) to display */
  targetCode?: string | CodeExample[]
  /** Example block title */
  title?: string
  /** HTTP method tag, e.g. GET, POST */
  tag?: string
  /** API path */
  label?: string
}>

export function CodeGroup({ children, title, targetCode, ...props }: CodeGroupProps) {
  const examples = typeof targetCode === 'string' ? [{ code: targetCode }] as CodeExample[] : targetCode
  const tabs = examples?.map(({ title }, index) => ({
    title: title || 'Code',
    value: String(index),
  })) || []
  const tabGroupProps = useTabGroupProps(tabs.map(tab => tab.value))
  const hasTabs = tabs.length > 1
  const content = (
    <>
      <CodeGroupHeader title={title} tabs={hasTabs ? tabs : undefined} />
      <CodeGroupPanels {...props} targetCode={examples} tabs={hasTabs ? tabs : undefined}>{children}</CodeGroupPanels>
    </>
  )

  return (
    <CodeGroupContext.Provider value={true}>
      {hasTabs
        ? (
            <Tabs
              {...tabGroupProps}
              className="not-prose my-6 overflow-hidden rounded-2xl bg-zinc-900 shadow-md dark:ring-1 dark:ring-white/10"
            >
              {content}
            </Tabs>
          )
        : (
            <div className="not-prose my-6 overflow-hidden rounded-2xl bg-zinc-900 shadow-md dark:ring-1 dark:ring-white/10">
              {content}
            </div>
          )}
    </CodeGroupContext.Provider>
  )
}

type IChildProps = {
  children: ReactNode
  [key: string]: any
}

export function Code({ children, ...props }: IChildProps) {
  return <code {...props}>{children}</code>
}

export function Pre({ children, ...props }: IChildrenProps) {
  const isGrouped = useContext(CodeGroupContext)

  if (isGrouped)
    return children

  return <CodeGroup {...props}>{children}</CodeGroup>
}

export function Embed({ value, ...props }: IChildrenProps) {
  return <span {...props}>{value}</span>
}
