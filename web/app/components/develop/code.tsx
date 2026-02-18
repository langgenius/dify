'use client'
import type { PropsWithChildren, ReactElement, ReactNode } from 'react'
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import {
  Children,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/utils/classnames'
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
      className={cn('group/button absolute right-4 top-1.5 overflow-hidden rounded-full py-1 pl-2 pr-3 text-2xs font-medium opacity-0 backdrop-blur transition focus:opacity-100 group-hover:opacity-100', copied
        ? 'bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20'
        : 'hover:bg-white/7.5 dark:bg-white/2.5 bg-white/5 dark:hover:bg-white/5')}
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
    <div className="border-b-white/7.5 bg-white/2.5 dark:bg-white/1 flex h-9 items-center gap-2 border-y border-t-transparent bg-zinc-900 px-4 dark:border-b-white/5">
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
    <div className="dark:bg-white/2.5 group">
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
  tabTitles?: string[]
  selectedIndex?: number
}

function CodeGroupHeader({ title, tabTitles, selectedIndex }: CodeGroupHeaderProps) {
  const hasTabs = (tabTitles?.length ?? 0) > 1

  return (
    <div className="flex min-h-[calc(theme(spacing.12)+1px)] flex-wrap items-start gap-x-4 border-b border-zinc-700 bg-zinc-800 px-4 dark:border-zinc-800 dark:bg-transparent">
      {title && (
        <h3 className="mr-auto pt-3 text-xs font-semibold text-white">
          {title}
        </h3>
      )}
      {hasTabs && (
        <TabList className="-mb-px flex gap-4 text-xs font-medium">
          {tabTitles!.map((tabTitle, tabIndex) => (
            <Tab
              key={tabIndex}
              className={cn('border-b py-3 transition focus:[&:not(:focus-visible)]:outline-none', tabIndex === selectedIndex
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-300')}
            >
              {tabTitle}
            </Tab>
          ))}
        </TabList>
      )}
    </div>
  )
}

type ICodeGroupPanelsProps = PropsWithChildren<{
  targetCode?: CodeExample[]
  [key: string]: any
}>

function CodeGroupPanels({ children, targetCode, ...props }: ICodeGroupPanelsProps) {
  if ((targetCode?.length ?? 0) > 1) {
    return (
      <TabPanels>
        {targetCode!.map((code, index) => (
          <TabPanel key={code.title || code.tag || index}>
            <CodePanel {...props} targetCode={code} />
          </TabPanel>
        ))}
      </TabPanels>
    )
  }

  return <CodePanel {...props} targetCode={targetCode?.[0]}>{children}</CodePanel>
}

function usePreventLayoutShift() {
  const positionRef = useRef<any>(null)
  const rafRef = useRef<any>(null)

  useEffect(() => {
    return () => {
      window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return {
    positionRef,
    preventLayoutShift(callback: () => {}) {
      const initialTop = positionRef.current.getBoundingClientRect().top

      callback()

      rafRef.current = window.requestAnimationFrame(() => {
        const newTop = positionRef.current.getBoundingClientRect().top
        window.scrollBy(0, newTop - initialTop)
      })
    },
  }
}

function useTabGroupProps(availableLanguages: string[]) {
  const [preferredLanguages, addPreferredLanguage] = useState<any>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const activeLanguage = [...(availableLanguages || [])].sort(
    (a, z) => preferredLanguages.indexOf(z) - preferredLanguages.indexOf(a),
  )[0]
  const languageIndex = availableLanguages?.indexOf(activeLanguage) || 0
  const newSelectedIndex = languageIndex === -1 ? selectedIndex : languageIndex
  if (newSelectedIndex !== selectedIndex)
    setSelectedIndex(newSelectedIndex)

  const { positionRef, preventLayoutShift } = usePreventLayoutShift()

  return {
    as: 'div',
    ref: positionRef,
    selectedIndex,
    onChange: (newSelectedIndex: number) => {
      preventLayoutShift(() =>
        (addPreferredLanguage(availableLanguages[newSelectedIndex]) as any),
      )
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
  const tabTitles = examples?.map(({ title }) => title || 'Code') || []
  const tabGroupProps = useTabGroupProps(tabTitles)
  const hasTabs = tabTitles.length > 1
  const Container = hasTabs ? TabGroup : 'div'
  const containerProps = hasTabs ? tabGroupProps : {}
  const headerProps = hasTabs
    ? { selectedIndex: tabGroupProps.selectedIndex, tabTitles }
    : {}

  return (
    <CodeGroupContext.Provider value={true}>
      <Container
        {...containerProps}
        className="not-prose my-6 overflow-hidden rounded-2xl bg-zinc-900 shadow-md dark:ring-1 dark:ring-white/10"
      >
        <CodeGroupHeader title={title} {...headerProps} />
        <CodeGroupPanels {...props} targetCode={examples}>{children}</CodeGroupPanels>
      </Container>
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
