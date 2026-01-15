import type { HeaderInNormalProps } from './header-in-normal'
import type { HeaderInRestoringProps } from './header-in-restoring'
import type { HeaderInHistoryProps } from './header-in-view-history'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import {
  useWorkflowMode,
} from '../hooks'
import { useStore } from '../store'
import HeaderInNormal from './header-in-normal'

const HeaderInHistory = dynamic(() => import('./header-in-view-history'), {
  ssr: false,
})
const HeaderInRestoring = dynamic(() => import('./header-in-restoring'), {
  ssr: false,
})

export type HeaderProps = {
  normal?: HeaderInNormalProps
  viewHistory?: HeaderInHistoryProps
  restoring?: HeaderInRestoringProps
}
const Header = ({
  normal: normalProps,
  viewHistory: viewHistoryProps,
  restoring: restoringProps,
}: HeaderProps) => {
  const pathname = usePathname()
  const inWorkflowCanvas = pathname.endsWith('/workflow')
  const isPipelineCanvas = pathname.endsWith('/pipeline')
  const {
    normal,
    restoring,
    viewHistory,
  } = useWorkflowMode()
  const maximizeCanvas = useStore(s => s.maximizeCanvas)

  return (
    <div
      className="absolute left-0 top-7 z-10 flex h-0 w-full items-center justify-between bg-mask-top2bottom-gray-50-to-transparent px-3"
    >
      {(inWorkflowCanvas || isPipelineCanvas) && maximizeCanvas && <div className="h-14 w-[52px]" />}
      {
        normal && (
          <HeaderInNormal
            {...normalProps}
          />
        )
      }
      {
        viewHistory && (
          <HeaderInHistory
            {...viewHistoryProps}
          />
        )
      }
      {
        restoring && (
          <HeaderInRestoring
            {...restoringProps}
          />
        )
      }
    </div>
  )
}

export default Header
