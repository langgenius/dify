import { RiArrowDownSLine, RiSparklingFill } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { cn } from '@/utils/classnames'
import s from './style.module.css'

type Props = {
  message: string
  className?: string
}
const PromptToast = ({
  message,
  className,
}: Props) => {
  const { t } = useTranslation()
  const [isFold, {
    toggle: toggleFold,
  }] = useBoolean(false)
  // const message = `
  // list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1
  // # h1
  // **strong text**  ~~strikethrough~~

  // * list1list1list1list1list1list1list1list1list1list1list1list1list1list1list1
  // * list2

  // xxxx

  // ## h2
  // \`\`\`python
  // print('Hello, World!')
  // \`\`\`
  //   `
  return (
    <div className={cn('rounded-xl border-[0.5px] border-components-panel-border bg-background-section-burn pl-4 shadow-xs', className)}>
      <div className="my-3 flex h-4 items-center justify-between pr-3">
        <div className="flex items-center space-x-1">
          <RiSparklingFill className="size-3.5 text-components-input-border-active-prompt-1" />
          <span className={cn(s.optimizationNoteText, 'system-xs-semibold-uppercase')}>{t('generate.optimizationNote', { ns: 'appDebug' })}</span>
        </div>
        <RiArrowDownSLine className={cn('size-4 cursor-pointer text-text-tertiary', isFold && 'rotate-[-90deg]')} onClick={toggleFold} />
      </div>
      {!isFold && (
        <div className="pb-4 pr-4">
          <Markdown className="!text-sm" content={message} />
        </div>
      )}
    </div>
  )
}

export default PromptToast
