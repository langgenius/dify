import type { ShortcutMapping } from './test-run-menu-helpers'
import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { OptionRow, SingleOptionTrigger, useShortcutMenu } from './test-run-menu-helpers'

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

const getEnabledOptions = (options: TestRunOptions) => {
  const flattened: TriggerOption[] = []

  if (options.userInput)
    flattened.push(options.userInput)
  if (options.runAll)
    flattened.push(options.runAll)
  flattened.push(...options.triggers)

  return flattened.filter(option => option.enabled !== false)
}

const getMenuVisibility = (options: TestRunOptions) => {
  return {
    hasUserInput: Boolean(options.userInput?.enabled !== false && options.userInput),
    hasTriggers: options.triggers.some(trigger => trigger.enabled !== false),
    hasRunAll: Boolean(options.runAll?.enabled !== false && options.runAll),
  }
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

// eslint-disable-next-line react/no-forward-ref
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

  const enabledOptions = useMemo(() => getEnabledOptions(options), [options])

  const hasSingleEnabledOption = enabledOptions.length === 1
  const soleEnabledOption = hasSingleEnabledOption ? enabledOptions[0] : undefined

  const runSoleOption = useCallback(() => {
    if (soleEnabledOption)
      handleSelect(soleEnabledOption)
  }, [handleSelect, soleEnabledOption])

  useShortcutMenu({
    open,
    shortcutMappings,
    handleSelect,
  })

  useImperativeHandle(ref, () => ({
    toggle: () => {
      if (hasSingleEnabledOption) {
        runSoleOption()
        return
      }

      setOpen(prev => !prev)
    },
  }), [hasSingleEnabledOption, runSoleOption])

  const renderOption = (option: TriggerOption) => {
    return <OptionRow option={option} shortcutKey={shortcutKeyById.get(option.id)} onSelect={handleSelect} />
  }

  const { hasUserInput, hasTriggers, hasRunAll } = useMemo(() => getMenuVisibility(options), [options])

  if (hasSingleEnabledOption && soleEnabledOption) {
    return (
      <SingleOptionTrigger runSoleOption={runSoleOption}>
        {children}
      </SingleOptionTrigger>
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
