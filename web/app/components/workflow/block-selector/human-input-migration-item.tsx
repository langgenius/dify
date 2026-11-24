import type { PopoverActions } from '@langgenius/dify-ui/popover'
import type { RefObject } from 'react'
import type { NodeDefault } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import BlockIcon from '../block-icon'

type HumanInputMigrationItemProps = {
  block: NodeDefault
  actionsRef: RefObject<PopoverActions | null>
  onOpen: () => void
  onMigrate?: () => void
}

export function HumanInputMigrationItem({
  block,
  actionsRef,
  onOpen,
  onMigrate,
}: HumanInputMigrationItemProps) {
  const { t } = useTranslation(['workflow'])
  const reasonId = useId()
  const { type, title, description } = block.metaData

  return (
    <Popover
      actionsRef={actionsRef}
      onOpenChange={(open) => {
        if (open) onOpen()
      }}
    >
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        aria-describedby={reasonId}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-start focus-visible:ring-0 focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
      >
        <BlockIcon type={type} size="md" className="shrink-0 opacity-30" />
        <span className="min-w-0 grow system-sm-medium text-text-secondary opacity-30">
          {title}
        </span>
        <Badge
          as="span"
          size="xs"
          variant="dimm"
          className="shrink-0 px-1.25 py-0.75"
          text={t(($) => $['nodes.humanInputMigration.disabledBadge'])}
        />
      </PopoverTrigger>
      <span id={reasonId} className="sr-only">
        {t(($) => $['nodes.humanInputMigration.disabledReason'])}
      </span>
      <PopoverContent
        side="right"
        className="flex w-56 max-w-(--available-width) flex-col gap-1 bg-components-panel-bg-blur p-1 backdrop-blur-[5px]"
      >
        <div className="flex flex-col items-start gap-1 p-2">
          <BlockIcon type={type} size="md" className="mb-1" />
          <PopoverTitle className="system-md-medium text-text-primary">{title}</PopoverTitle>
          <p className="system-xs-regular wrap-break-word text-text-secondary">{description}</p>
        </div>
        <div className="flex flex-col items-start gap-2 rounded-lg bg-background-section p-2">
          <div className="flex flex-col gap-1 text-text-secondary">
            <span aria-hidden className="i-custom-vender-agent-v2-access-point size-4" />
            <PopoverDescription className="max-w-47 system-xs-regular">
              {t(($) => $['nodes.humanInputMigration.preview.description'])}
            </PopoverDescription>
          </div>
          {onMigrate && (
            <PopoverClose render={<Button size="small" variant="primary" />} onClick={onMigrate}>
              {t(($) => $['nodes.humanInputMigration.action.migrateNow'])}
              <span aria-hidden className="i-ri-arrow-right-line size-3.5" />
            </PopoverClose>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
