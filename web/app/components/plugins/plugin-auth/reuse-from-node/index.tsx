import type { ReusableNode, ReuseFromNodeReference } from './model'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Select,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

export type ReuseFromNodeProps = {
  nodes?: ReusableNode[]
  value?: ReuseFromNodeReference
  onChange?: (node: ReusableNode) => void
  onLocate?: (nodeId: string) => void
}

const ReuseFromNode = ({ nodes = [], value, onChange, onLocate }: ReuseFromNodeProps) => {
  const { t } = useTranslation(['plugin'])
  const selectedNode = nodes.find((node) => node.id === value?.id)
  const reference = selectedNode ?? value
  const removed = !!value && !selectedNode
  const sourceLabel = (source: ReusableNode['source']) =>
    source === 'app-user'
      ? t(($) => $['auth.reuse.appUser'], { ns: 'plugin' })
      : source === 'reuse'
        ? t(($) => $['auth.reuseFromNode'], { ns: 'plugin' })
        : t(($) => $['auth.reuse.workspace'], { ns: 'plugin' })
  const locateLabel = t(($) => $['auth.reuse.locateSource'], { ns: 'plugin' })

  return (
    <div className="space-y-2">
      <Select
        items={nodes.map((node) => ({ value: node.id, label: node.title }))}
        value={value?.id ?? null}
        disabled={!nodes.length}
        readOnly={removed && !nodes.length}
        onValueChange={(nodeId) => {
          const node = nodes.find((item) => item.id === nodeId)
          if (node && !node.disabled) onChange?.(node)
        }}
      >
        <SelectTrigger
          aria-label={t(($) => $['auth.reuse.selectNode'], { ns: 'plugin' })}
          aria-invalid={removed || undefined}
          className={cn(
            'px-2',
            !nodes.length && !removed && 'opacity-50',
            removed &&
              'inset-ring-1 inset-ring-components-input-border-destructive data-disabled:bg-components-input-bg-normal data-disabled:text-components-input-text-filled',
          )}
        >
          <SelectValue<string> placeholder={t(($) => $['auth.reuse.selectNode'], { ns: 'plugin' })}>
            {() =>
              reference ? (
                <span className="flex min-w-0 items-center gap-2 text-text-secondary">
                  <AppIcon
                    size="tiny"
                    className="size-5 rounded-md bg-background-default-dodge"
                    iconType={typeof reference.icon === 'string' ? 'image' : 'emoji'}
                    imageUrl={typeof reference.icon === 'string' ? reference.icon : undefined}
                    icon={typeof reference.icon === 'object' ? reference.icon.content : undefined}
                    background={
                      typeof reference.icon === 'object' ? reference.icon.background : undefined
                    }
                    decorative
                  />
                  <span className="min-w-0 grow truncate">{reference.title}</span>
                  {removed && (
                    <span className="shrink-0 system-xs-regular text-text-destructive">
                      {t(($) => $['auth.reuse.removed'], { ns: 'plugin' })}
                    </span>
                  )}
                </span>
              ) : (
                t(($) => $['auth.reuse.selectNode'], { ns: 'plugin' })
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner>
            <SelectPopup className="rounded-[10px] border border-divider-regular shadow-md">
              <SelectList className="space-y-0.5">
                {nodes.map((node) => (
                  <SelectItem
                    key={node.id}
                    value={node.id}
                    disabled={node.disabled}
                    className="h-auto min-h-12.5 items-start gap-2 rounded-md py-2"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <SelectItemIndicator />
                    </span>
                    <div className="min-w-0 grow space-y-0.5">
                      <SelectItemText className="m-0 block overflow-visible px-0 wrap-break-word text-clip whitespace-normal">
                        {node.title}
                      </SelectItemText>
                      <div className="flex items-center justify-between gap-2 system-xs-regular">
                        <span className="text-text-tertiary">{sourceLabel(node.source)}</span>
                        {node.connectionExpired && (
                          <span className="text-text-warning">
                            {t(($) => $['auth.reuse.connectionExpired'], { ns: 'plugin' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
      {selectedNode && (
        <div className="flex h-6 items-center justify-between gap-2">
          <span className="system-xs-regular leading-4.5 text-text-tertiary">
            {t(($) => $['auth.reuse.source'], {
              ns: 'plugin',
              type: sourceLabel(selectedNode.source),
            })}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <IconButton aria-label={locateLabel} onClick={() => onLocate?.(selectedNode.id)}>
                  <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
                </IconButton>
              }
            />
            <TooltipContent placement="bottom-end">{locateLabel}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

export default ReuseFromNode
