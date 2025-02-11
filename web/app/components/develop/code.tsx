'use client'
import {
  Children,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Tab } from '@headlessui/react'
import { Tag } from './tag'
import classNames from '@/utils/classnames'
import { writeTextToClipboard } from '@/utils/clipboard'

const languageNames = {
  js: 'JavaScript',
  ts: 'TypeScript',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  php: 'PHP',
  python: 'Python',
  ruby: 'Ruby',
  go: 'Go',
} as { [key: string]: string }

type IChildrenProps = {
  children: React.ReactElement
  [key: string]: any
}

function getPanelTitle({ className }: { className: string }) {
  const language = className.split('-')[1]
  return languageNames[language] ?? 'Code'
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
      className={classNames(
        'group/button absolute top-3.5 right-4 overflow-hidden rounded-full py-1 pl-2 pr-3 text-2xs font-medium opacity-0 backdrop-blur transition focus:opacity-100 group-hover:opacity-100',
        copied
          ? 'bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20'
          : 'bg-white/5 hover:bg-white/7.5 dark:bg-white/2.5 dark:hover:bg-white/5',
      )}
      onClick={() => {
        writeTextToClipboard(code).then(() => {
          setCopyCount(count => count + 1)
        })
      }}
    >
      <span
        aria-hidden={copied}
        className={classNames(
          'pointer-events-none flex items-center gap-0.5 text-zinc-400 transition duration-300',
          copied && '-translate-y-1.5 opacity-0',
        )}
      >
        <ClipboardIcon className="w-5 h-5 transition-colors fill-zinc-500/20 stroke-zinc-500 group-hover/button:stroke-zinc-400" />
        Copy
      </span>
      <span
        aria-hidden={!copied}
        className={classNames(
          'pointer-events-none absolute inset-0 flex items-center justify-center text-emerald-400 transition duration-300',
          !copied && 'translate-y-1.5 opacity-0',
        )}
      >
        Copied!
      </span>
    </button>
  )
}

function CodePanelHeader({ tag, label }: { tag: string; label: string }) {
  if (!tag && !label)
    return null

  return (
    <div className="flex h-9 items-center gap-2 border-y border-t-transparent border-b-white/7.5 bg-zinc-900 bg-white/2.5 px-4 dark:border-b-white/5 dark:bg-white/1">
      {tag && (
        <div className="flex dark">
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

type ICodePanelProps = {
  children: React.ReactElement
  tag?: string
  code?: string
  label?: string
  targetCode?: string
}
function CodePanel({ tag, label, code, children, targetCode }: ICodePanelProps) {
  const child = Children.only(children)

  return (
    <div className="group dark:bg-white/2.5">
      <CodePanelHeader
        tag={child.props.tag ?? tag}
        label={child.props.label ?? label}
      />
      <div className="relative">
        {/* <pre className="p-4 overflow-x-auto text-xs text-white">{children}</pre> */}
        {/* <CopyButton code={child.props.code ?? code} /> */}
        {/* <CopyButton code={child.props.children.props.children} /> */}
        <pre className="p-4 overflow-x-auto text-xs text-white">{targetCode || children}</pre>
        <CopyButton code={targetCode || child.props.children.props.children} />
      </div>
    </div>
  )
}

function CodeGroupHeader({ title, children, selectedIndex }: IChildrenProps) {
  const hasTabs = Children.count(children) > 1

  if (!title && !hasTabs)
    return null

  return (
    <div className="flex min-h-[calc(theme(spacing.12)+1px)] flex-wrap items-start gap-x-4 border-b border-zinc-700 bg-zinc-800 px-4 dark:border-zinc-800 dark:bg-transparent">
      {title && (
        <h3 className="pt-3 mr-auto text-xs font-semibold text-white">
          {title}
        </h3>
      )}
      {hasTabs && (
        <Tab.List className="flex gap-4 -mb-px text-xs font-medium">
          {Children.map(children, (child, childIndex) => (
            <Tab
              className={classNames(
                'border-b py-3 transition focus:[&:not(:focus-visible)]:outline-none',
                childIndex === selectedIndex
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-300',
              )}
            >
              {getPanelTitle(child.props.children.props)}
            </Tab>
          ))}
        </Tab.List>
      )}
    </div>
  )
}

type ICodeGroupPanelsProps = {
  children: React.ReactElement
  [key: string]: any
}
function CodeGroupPanels({ children, targetCode, ...props }: ICodeGroupPanelsProps) {
  const hasTabs = Children.count(children) > 1

  if (hasTabs) {
    return (
      <Tab.Panels>
        {Children.map(children, child => (
          <Tab.Panel>
            <CodePanel {...props}>{child}</CodePanel>
          </Tab.Panel>
        ))}
      </Tab.Panels>
    )
  }

  return <CodePanel {...props} targetCode={targetCode}>{children}</CodePanel>
}

function usePreventLayoutShift() {
  const positionRef = useRef<any>()
  const rafRef = useRef<any>()

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
  const activeLanguage = [...availableLanguages].sort(
    (a, z) => preferredLanguages.indexOf(z) - preferredLanguages.indexOf(a),
  )[0]
  const languageIndex = availableLanguages.indexOf(activeLanguage)
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

export function CodeGroup({ children, title, inputs, targetCode, ...props }: IChildrenProps) {
  const languages = Children.map(children, child =>
    getPanelTitle(child.props.children.props),
  )
  const tabGroupProps = useTabGroupProps(languages)
  const hasTabs = Children.count(children) > 1
  const Container = hasTabs ? Tab.Group : 'div'
  const containerProps = hasTabs ? tabGroupProps : {}
  const headerProps = hasTabs
    ? { selectedIndex: tabGroupProps.selectedIndex }
    : {}

  return (
    <CodeGroupContext.Provider value={true}>
      <Container
        {...containerProps}
        className="my-6 overflow-hidden shadow-md not-prose rounded-2xl bg-zinc-900 dark:ring-1 dark:ring-white/10"
      >
        <CodeGroupHeader title={title} {...headerProps}>
          {children}
        </CodeGroupHeader>
        <CodeGroupPanels {...props} targetCode={targetCode}>{children}</CodeGroupPanels>
      </Container>
    </CodeGroupContext.Provider>
  )
}

type IChildProps = {
  children: string
  [key: string]: any
}
export function Code({ children, ...props }: IChildProps) {
  const isGrouped = useContext(CodeGroupContext)

  if (isGrouped)
    return <code {...props} dangerouslySetInnerHTML={{ __html: children }} />

  return <code {...props}>{children}</code>
}

export function Pre({ children, ...props }: IChildrenProps) {
  const isGrouped = useContext(CodeGroupContext)

  if (isGrouped)
    return children

  return <CodeGroup {...props}>{children}</CodeGroup>
}
