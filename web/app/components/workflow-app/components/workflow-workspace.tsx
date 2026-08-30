import type { ReactNode, Ref } from 'react'
import type { WorkflowProps } from '@/app/components/workflow'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store/store'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { Workflow } from '@/app/components/workflow'
import { HooksStoreContextProvider } from '@/app/components/workflow/hooks-store'
import { useStore } from '@/app/components/workflow/store'
import dynamic from '@/next/dynamic'
import { DifyBuilderProvider } from './dify-builder/provider'

const DifyBuilderPanel = dynamic(() => import('./dify-builder/panel'), {
  ssr: false,
})

type WorkflowWorkspaceProps = WorkflowProps & {
  canvasOverlay?: ReactNode
  canvasRef?: Ref<HTMLDivElement>
  hooksStore?: Partial<HooksStoreShape>
}

const DifyBuilderSidebar = () => {
  const showDifyBuilderPanel = useStore((state) => state.showDifyBuilderPanel)

  return showDifyBuilderPanel ? <DifyBuilderPanel /> : null
}

const WorkflowWorkspace = ({
  canvasOverlay,
  canvasRef,
  children,
  className,
  hooksStore,
  ...workflowProps
}: WorkflowWorkspaceProps) => {
  return (
    <HooksStoreContextProvider {...hooksStore}>
      <DifyBuilderProvider>
        <div className="flex size-full min-w-0 overflow-hidden">
          <div ref={canvasRef} className="relative min-w-0 flex-1 overflow-hidden">
            <Workflow {...workflowProps} className={cn('min-w-0', className)}>
              {children}
            </Workflow>
            {canvasOverlay}
          </div>
          <DifyBuilderSidebar />
        </div>
      </DifyBuilderProvider>
    </HooksStoreContextProvider>
  )
}

export default memo(WorkflowWorkspace)
