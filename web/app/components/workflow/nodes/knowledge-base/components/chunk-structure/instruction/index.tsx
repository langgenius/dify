import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AddChunks } from '@/app/components/base/icons/src/vender/knowledge'
import { useDocLink } from '@/context/i18n'
import { cn } from '@/utils/classnames'
import Line from './line'

type InstructionProps = {
  className?: string
}

const Instruction = ({
  className,
}: InstructionProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <div className={cn('flex flex-col gap-y-2 overflow-hidden rounded-[10px] bg-workflow-process-bg p-4', className)}>
      <div className="relative flex size-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-[5px]">
        <AddChunks className="size-5 text-text-accent" />
        <Line className="absolute -left-px bottom-[-76px]" type="vertical" />
        <Line className="absolute -right-px bottom-[-76px]" type="vertical" />
        <Line className="absolute -top-px right-[-184px]" type="horizontal" />
        <Line className="absolute -bottom-px right-[-184px]" type="horizontal" />
      </div>
      <div className="flex flex-col gap-y-1">
        <div className="system-sm-medium text-text-secondary">
          {t('nodes.knowledgeBase.chunkStructureTip.title', { ns: 'workflow' })}
        </div>
        <div className="system-xs-regular">
          <p className="text-text-tertiary">{t('nodes.knowledgeBase.chunkStructureTip.message', { ns: 'workflow' })}</p>
          <a
            href={docLink('/use-dify/knowledge/create-knowledge/chunking-and-cleaning-text')}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-accent"
          >
            {t('nodes.knowledgeBase.chunkStructureTip.learnMore', { ns: 'workflow' })}
          </a>
        </div>
      </div>
    </div>
  )
}

export default React.memo(Instruction)
