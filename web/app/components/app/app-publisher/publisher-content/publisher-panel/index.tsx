import type { ComponentProps } from 'react'
import type { AppPublisherProps } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { WorkflowLaunchDialog } from '@/app/components/app/overview/workflow-launch-dialog'
import { BuiltInPublisher } from '../../built-in-publisher'
import { PublisherEnvironmentFlow } from '../../environment-deployment-flow'

type PublisherPanelProps = Pick<AppPublisherProps, 'crossAxisOffset' | 'disabled'> & {
  builtInPublisher: ComponentProps<typeof BuiltInPublisher>
  environmentPublisher: ComponentProps<typeof PublisherEnvironmentFlow>
  environmentPublisherKey: string
  open: boolean
  showBuiltInPublisher: boolean
  workflowLaunch: ComponentProps<typeof WorkflowLaunchDialog>
  onOpenChange: (open: boolean) => void
}

export function PublisherPanel({
  builtInPublisher,
  crossAxisOffset = 0,
  disabled = false,
  environmentPublisher,
  environmentPublisherKey,
  onOpenChange,
  open,
  showBuiltInPublisher,
  workflowLaunch,
}: PublisherPanelProps) {
  const { t } = useTranslation()

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="primary" className="py-2 pr-2 pl-3" disabled={disabled}>
            {t(($) => $['common.publish'], { ns: 'workflow' })}
            <span className="i-ri-arrow-down-s-line size-4 text-components-button-primary-text" />
          </Button>
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        alignOffset={crossAxisOffset}
        className="border-none bg-transparent shadow-none"
      >
        <div className="flex max-h-[calc(100dvh-32px)] w-88 flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
          {showBuiltInPublisher ? (
            <BuiltInPublisher {...builtInPublisher} />
          ) : (
            <PublisherEnvironmentFlow key={environmentPublisherKey} {...environmentPublisher} />
          )}
        </div>
      </PopoverContent>
      <WorkflowLaunchDialog {...workflowLaunch} />
    </Popover>
  )
}
