import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Home from '@/app/components/base/icons/src/vender/workflow/Home'
import Google from '@/app/components/base/icons/src/public/plugins/Google'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export type TriggerOption = {
  id: string
  type: 'user_input' | 'schedule' | 'webhook' | 'plugin' | 'all'
  name: string
  icon: React.ReactNode
  nodeId?: string
  enabled: boolean
}

export type TestRunOptions = {
  userInput?: TriggerOption
  triggers: TriggerOption[]
  runAll?: TriggerOption
}

type TestRunDropdownProps = {
  options: TestRunOptions
  onSelect: (option: TriggerOption) => void
  children: React.ReactNode
}

const createMockOptions = (): TestRunOptions => {
  const userInput: TriggerOption = {
    id: 'user-input-1',
    type: 'user_input',
    name: 'User Input',
    icon: (
      <div className="flex h-6 w-6 items-center justify-center rounded bg-util-colors-blue-brand-blue-brand-500">
        <Home className="h-4 w-4 text-text-primary-on-surface" />
      </div>
    ),
    nodeId: 'start-node-1',
    enabled: true,
  }

  const runAll: TriggerOption = {
    id: 'run-all',
    type: 'all',
    name: 'Run all triggers',
    icon: (
      <div className="flex h-6 w-6 items-center justify-center rounded bg-util-colors-purple-purple-500">
        <svg className="h-4 w-4 text-text-primary-on-surface" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      </div>
    ),
    enabled: true,
  }

  const triggers: TriggerOption[] = [
    {
      id: 'slack-trigger-1',
      type: 'plugin',
      name: 'Slack Trigger',
      icon: (
        <div className="flex h-6 w-6 items-center justify-center">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52-2.523c0-1.393 1.125-2.528 2.52-2.528h2.52v2.528c0 1.393-1.125 2.523-2.52 2.523zM6.313 17c0-1.393 1.125-2.528 2.52-2.528s2.52 1.135 2.52 2.528v6.315c0 1.393-1.125 2.528-2.52 2.528s-2.52-1.135-2.52-2.528V17z" fill="#e01e5a"/>
            <path d="M8.835 5.042a2.528 2.528 0 0 1-2.523-2.52C6.312 1.127 7.447.002 8.835.002s2.523 1.125 2.523 2.52v2.52H8.835zM17 6.313c1.393 0 2.528 1.125 2.528 2.52s-1.135 2.52-2.528 2.52H10.685c-1.393 0-2.528-1.125-2.528-2.52s1.135-2.52 2.528-2.52H17z" fill="#36c5f0"/>
            <path d="M18.958 8.835a2.528 2.528 0 0 1 2.52-2.523c1.393 0 2.528 1.125 2.528 2.523s-1.125 2.523-2.528 2.523h-2.52V8.835zM17.687 17c0-1.393-1.125-2.528-2.52-2.528s-2.52 1.135-2.52 2.528v6.315c0 1.393 1.125 2.528 2.52 2.528s2.52-1.135 2.52-2.528V17z" fill="#2eb67d"/>
            <path d="M15.165 18.958a2.528 2.528 0 0 1 2.523-2.52c1.393 0 2.528 1.125 2.528 2.52s-1.125 2.523-2.528 2.523h-2.523v-2.523zM7 17.687c-1.393 0-2.528-1.125-2.528-2.52s1.135-2.sk 2.528-2.52h6.315c1.393 0 2.528 1.125 2.528 2.sk s-1.135 2.sk-2.528 2.sk H7z" fill="#ecb22e"/>
          </svg>
        </div>
      ),
      nodeId: 'slack-trigger-1',
      enabled: true,
    },
    {
      id: 'zapier-trigger-1',
      type: 'plugin',
      name: 'Zapier Trigger',
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded bg-util-colors-orange-orange-500">
          <svg className="h-4 w-4 text-text-primary-on-surface" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0L8.25 8.25H0l6.75 6.75L3 24l9-6.75L21 24l-3.75-9L24 8.25h-8.25L12 0z"/>
          </svg>
        </div>
      ),
      nodeId: 'zapier-trigger-1',
      enabled: true,
    },
    {
      id: 'gmail-trigger-1',
      type: 'plugin',
      name: 'Gmail Sender',
      icon: (
        <div className="flex h-6 w-6 items-center justify-center rounded bg-components-panel-bg">
          <Google className="h-5 w-5" />
        </div>
      ),
      nodeId: 'gmail-trigger-1',
      enabled: true,
    },
  ]

  return {
    userInput,
    triggers,
    runAll: triggers.length > 1 ? runAll : undefined,
  }
}

const TestRunDropdown: FC<TestRunDropdownProps> = ({
  options,
  onSelect,
  children,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleSelect = (option: TriggerOption) => {
    onSelect(option)
    setOpen(false)
  }

  const renderOption = (option: TriggerOption, numberDisplay: string) => (
    <div
      key={option.id}
      className='system-md-regular flex cursor-pointer items-center rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'
      onClick={() => handleSelect(option)}
    >
      <div className='flex min-w-0 flex-1 items-center'>
        <div className='flex h-6 w-6 shrink-0 items-center justify-center'>
          {option.icon}
        </div>
        <span className='ml-2 truncate'>{option.name}</span>
      </div>
      <div className='ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-state-base-hover-alt text-xs font-medium text-text-tertiary'>
        {numberDisplay}
      </div>
    </div>
  )

  const hasUserInput = !!options.userInput
  const hasTriggers = options.triggers.length > 0
  const hasRunAll = !!options.runAll

  let currentIndex = 0

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{ mainAxis: 8, crossAxis: -4 }}
    >
      <PortalToFollowElemTrigger asChild onClick={() => setOpen(!open)}>
        <div style={{ userSelect: 'none' }}>
          {children}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[12]'>
        <div className='w-[284px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg'>
          <div className='mb-2 px-3 pt-2 text-sm font-medium text-text-primary'>
            {t('workflow.common.chooseStartNodeToRun')}
          </div>
          <div>
            {hasUserInput && renderOption(options.userInput!, '~')}

            {(hasTriggers || hasRunAll) && hasUserInput && (
              <div className='mx-3 my-1 h-px bg-divider-subtle' />
            )}

            {hasRunAll && renderOption(options.runAll!, String(currentIndex++))}

            {hasTriggers && options.triggers.map(trigger =>
              renderOption(trigger, String(currentIndex++)),
            )}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export { createMockOptions }
export default TestRunDropdown
