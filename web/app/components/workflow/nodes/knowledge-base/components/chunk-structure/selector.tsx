import type { ReactNode } from 'react'
import type { ChunkStructureEnum } from '../../types'
import type { Option } from './type'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import OptionCard from '../option-card'

type SelectorProps = {
  options: Option[]
  value?: ChunkStructureEnum
  onChange: (key: ChunkStructureEnum) => void
  readonly?: boolean
  trigger?: ReactNode
}
const Selector = ({
  options,
  value,
  onChange,
  readonly,
  trigger,
}: SelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleSelect = useCallback((optionId: ChunkStructureEnum) => {
    onChange(optionId)
    setOpen(false)
  }, [onChange])

  return (
    <PortalToFollowElem
      placement="bottom-end"
      offset={{
        mainAxis: 0,
        crossAxis: -8,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger
        asChild
        onClick={() => {
          if (readonly)
            return
          setOpen(!open)
        }}
      >
        {
          trigger || (
            <Button
              size="small"
              variant="ghost-accent"
            >
              {t('panel.change', { ns: 'workflow' })}
            </Button>
          )
        }
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-10">
        <div className="w-[404px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl backdrop-blur-[5px]">
          <div className="system-sm-semibold px-3 pt-3.5 text-text-primary">
            {t('nodes.knowledgeBase.changeChunkStructure', { ns: 'workflow' })}
          </div>
          <div className="space-y-1 p-3 pt-2">
            {
              options.map(option => (
                <OptionCard
                  key={option.id}
                  id={option.id}
                  selectedId={value}
                  icon={option.icon}
                  title={option.title}
                  description={option.description}
                  readonly={readonly}
                  onClick={handleSelect}
                  effectColor={option.effectColor}
                >
                </OptionCard>
              ))
            }
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Selector
