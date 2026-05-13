import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AddChunks } from '@/app/components/base/icons/src/vender/knowledge'
import Line from './line'

type InstructionProps = {
  className?: string
}

const Instruction = ({
  className,
}: InstructionProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex flex-col gap-y-2 overflow-hidden rounded-[10px] bg-workflow-process-bg p-4', className)}>
      <div className="relative flex size-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-[5px]">
        <AddChunks className="size-5 text-text-accent" />
        <Line className="absolute bottom-[-76px] -left-px" type="vertical" />
        <Line className="absolute -right-px bottom-[-76px]" type="vertical" />
        <Line className="absolute -top-px right-[-184px]" type="horizontal" />
        <Line className="absolute right-[-184px] -bottom-px" type="horizontal" />
      </div>
      <div className="flex flex-col gap-y-1">
        <div className="system-sm-medium text-text-secondary">
          {t('nodes.knowledgeBase.chunkStructureTip.title', { ns: 'workflow' })}
        </div>
        <div className="system-xs-regular">
          <p className="text-text-tertiary">{t('nodes.knowledgeBase.chunkStructureTip.message', { ns: 'workflow' })}</p>
        </div>
      </div>
    </div>
  )
}

export default React.memo(Instruction)
