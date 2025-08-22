import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export default TestRunDropdown
