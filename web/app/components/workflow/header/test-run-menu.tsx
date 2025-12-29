import type { MouseEvent, MouseEventHandler, ReactElement } from 'react'
import {
  cloneElement,
  forwardRef,
  isValidElement,

  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ShortcutsName from '../shortcuts-name'

export enum TriggerType {
  UserInput = 'user_input',
  Schedule = 'schedule',
  Webhook = 'webhook',
  Plugin = 'plugin',
  All = 'all',
}

export type TriggerOption = {
  id: string
  type: TriggerType
  name: string
  icon: React.ReactNode
  nodeId?: string
  relatedNodeIds?: string[]
  enabled: boolean
}

export type TestRunOptions = {
  userInput?: TriggerOption
  triggers: TriggerOption[]
  runAll?: TriggerOption
}

type TestRunMenuProps = {
  options: TestRunOptions
  onSelect: (option: TriggerOption) => void
  children: React.ReactNode
}

export type TestRunMenuRef = {
  toggle: () => void
}

type ShortcutMapping = {
  option: TriggerOption
  shortcutKey: string
}

const buildShortcutMappings = (options: TestRunOptions): ShortcutMapping[] => {
  const mappings: ShortcutMapping[] = []

  if (options.userInput && options.userInput.enabled !== false)
    mappings.push({ option: options.userInput, shortcutKey: '~' })

  let numericShortcut = 0

  if (options.runAll && options.runAll.enabled !== false)
    mappings.push({ option: options.runAll, shortcutKey: String(numericShortcut++) })

  options.triggers.forEach((trigger) => {
    if (trigger.enabled !== false)
      mappings.push({ option: trigger, shortcutKey: String(numericShortcut++) })
  })

  return mappings
}

const TestRunMenu = forwardRef<TestRunMenuRef, TestRunMenuProps>(({
  options,
  onSelect,
  children,
}, ref) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const shortcutMappings = useMemo(() => buildShortcutMappings(options), [options])
  const shortcutKeyById = useMemo(() => {
    const map = new Map<string, string>()
    shortcutMappings.forEach(({ option, shortcutKey }) => {
      map.set(option.id, shortcutKey)
    })
    return map
  }, [shortcutMappings])

  const handleSelect = useCallback((option: TriggerOption) => {
    onSelect(option)
    setOpen(false)
  }, [onSelect])

  const enabledOptions = useMemo(() => {
    const flattened: TriggerOption[] = []

    if (options.userInput)
      flattened.push(options.userInput)
    if (options.runAll)
      flattened.push(options.runAll)
    flattened.push(...options.triggers)

    return flattened.filter(option => option.enabled !== false)
  }, [options])

  const hasSingleEnabledOption = enabledOptions.length === 1
  const soleEnabledOption = hasSingleEnabledOption ? enabledOptions[0] : undefined

  const runSoleOption = useCallback(() => {
    if (soleEnabledOption)
      handleSelect(soleEnabledOption)
  }, [handleSelect, soleEnabledOption])

  useImperativeHandle(ref, () => ({
    toggle: () => {
      if (hasSingleEnabledOption) {
        runSoleOption()
        return
      }

      setOpen(prev => !prev)
    },
  }), [hasSingleEnabledOption, runSoleOption])

  useEffect(() => {
    if (!open)
      return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey)
        return

      const normalizedKey = event.key === '`' ? '~' : event.key
      const mapping = shortcutMappings.find(({ shortcutKey }) => shortcutKey === normalizedKey)

      if (mapping) {
        event.preventDefault()
        handleSelect(mapping.option)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleSelect, open, shortcutMappings])

  const renderOption = (option: TriggerOption) => {
    const shortcutKey = shortcutKeyById.get(option.id)

    return (
      <div
        key={option.id}
        className="system-md-regular flex cursor-pointer items-center rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover"
        onClick={() => handleSelect(option)}
      >
        <div className="flex min-w-0 flex-1 items-center">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center">
            {option.icon}
          </div>
          <span className="ml-2 truncate">{option.name}</span>
        </div>
        {shortcutKey && (
          <ShortcutsName keys={[shortcutKey]} className="ml-2" textColor="secondary" />
        )}
      </div>
    )
  }

  const hasUserInput = !!options.userInput && options.userInput.enabled !== false
  const hasTriggers = options.triggers.some(trigger => trigger.enabled !== false)
  const hasRunAll = !!options.runAll && options.runAll.enabled !== false

  if (hasSingleEnabledOption && soleEnabledOption) {
    const handleRunClick = (event?: MouseEvent<HTMLElement>) => {
      if (event?.defaultPrevented)
        return

      runSoleOption()
    }

    if (isValidElement(children)) {
      const childElement = children as ReactElement<{ onClick?: MouseEventHandler<HTMLElement> }>
      const originalOnClick = childElement.props?.onClick

      return cloneElement(childElement, {
        onClick: (event: MouseEvent<HTMLElement>) => {
          if (typeof originalOnClick === 'function')
            originalOnClick(event)

          if (event?.defaultPrevented)
            return

          runSoleOption()
        },
      })
    }

    return (
      <span onClick={handleRunClick}>
        {children}
      </span>
    )
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={{ mainAxis: 8, crossAxis: -4 }}
    >
      <PortalToFollowElemTrigger asChild onClick={() => setOpen(!open)}>
        <div style={{ userSelect: 'none' }}>
          {children}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[12]">
        <div className="w-[284px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg">
          <div className="mb-2 px-3 pt-2 text-sm font-medium text-text-primary">
            {t('common.chooseStartNodeToRun', { ns: 'workflow' })}
          </div>
          <div>
            {hasUserInput && renderOption(options.userInput!)}

            {(hasTriggers || hasRunAll) && hasUserInput && (
              <div className="mx-3 my-1 h-px bg-divider-subtle" />
            )}

            {hasRunAll && renderOption(options.runAll!)}

            {hasTriggers && options.triggers
              .filter(trigger => trigger.enabled !== false)
              .map(trigger => renderOption(trigger))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
})

TestRunMenu.displayName = 'TestRunMenu'

export default TestRunMenu
