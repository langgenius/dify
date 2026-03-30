import Button from '@/app/components/base/button'
import { cn } from '@/utils/classnames'
import PoweredByBrand from './powered-by-brand'

type WorkflowPreviewCardProps = {
  webappBrandRemoved?: boolean
  workspaceLogo?: string
  webappLogo?: string
  imgKey: number
}

const WorkflowPreviewCard = ({
  webappBrandRemoved,
  workspaceLogo,
  webappLogo,
  imgKey,
}: WorkflowPreviewCardProps) => {
  return (
    <div className="flex h-[320px] grow basis-1/2 flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border-subtle bg-background-default-burn">
      <div className="w-full border-b-[0.5px] border-divider-subtle p-4 pb-0">
        <div className="mb-2 flex items-center gap-3">
          <div className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg border border-divider-regular', 'bg-components-icon-bg-indigo-solid')}>
            <span className="i-ri-exchange-2-fill h-4 w-4 text-components-avatar-shape-fill-stop-100" />
          </div>
          <div className="grow text-text-secondary system-md-semibold">Workflow App</div>
          <div className="p-1.5">
            <span className="i-ri-layout-left-2-line h-4 w-4 text-text-tertiary" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex h-10 shrink-0 items-center border-b-2 border-components-tab-active text-text-primary system-md-semibold-uppercase">RUN ONCE</div>
          <div className="flex h-10 grow items-center border-b-2 border-transparent text-text-tertiary system-md-semibold-uppercase">RUN BATCH</div>
        </div>
      </div>
      <div className="grow bg-components-panel-bg">
        <div className="p-4 pb-1">
          <div className="mb-1 py-2">
            <div className="h-2 w-20 rounded-sm bg-text-quaternary opacity-20"></div>
          </div>
          <div className="h-16 w-full rounded-lg bg-components-input-bg-normal"></div>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <Button size="small">
            <div className="h-2 w-10 rounded-sm bg-text-quaternary opacity-20"></div>
          </Button>
          <Button variant="primary" size="small" disabled>
            <span className="i-ri-play-large-line mr-1 h-4 w-4" />
            <span>Execute</span>
          </Button>
        </div>
      </div>
      <div className="flex h-12 shrink-0 items-center gap-1.5 bg-components-panel-bg p-4 pt-3">
        <PoweredByBrand
          webappBrandRemoved={webappBrandRemoved}
          workspaceLogo={workspaceLogo}
          webappLogo={webappLogo}
          imgKey={imgKey}
        />
      </div>
    </div>
  )
}

export default WorkflowPreviewCard
