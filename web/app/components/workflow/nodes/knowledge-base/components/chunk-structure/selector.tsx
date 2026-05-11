import type { ReactNode } from 'react'
import type { ChunkStructureEnum } from '../../types'
import type { Option } from './type'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (readonly && nextOpen)
      return
    setOpen(nextOpen)
  }, [readonly])

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      {
        trigger
          ? (
              <PopoverTrigger
                nativeButton={false}
                render={<div />}
              >
                {trigger}
              </PopoverTrigger>
            )
          : (
              <PopoverTrigger
                render={(
                  <Button
                    size="small"
                    variant="ghost-accent"
                  />
                )}
              >
                {t('panel.change', { ns: 'workflow' })}
              </PopoverTrigger>
            )
      }
      <PopoverContent
        placement="bottom-end"
        sideOffset={0}
        alignOffset={-8}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-[404px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl backdrop-blur-[5px]">
          <div className="px-3 pt-3.5 system-sm-semibold text-text-primary">
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
      </PopoverContent>
    </Popover>
  )
}

export default Selector
