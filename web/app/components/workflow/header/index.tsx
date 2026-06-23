import type { HeaderInNormalProps } from './header-in-normal'
import type { HeaderInRestoringProps } from './header-in-restoring'
import type { HeaderInHistoryProps } from './header-in-view-history'
import dynamic from '@/next/dynamic'
import {
  useWorkflowMode,
} from '../hooks'
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
  const {
    normal,
    restoring,
    viewHistory,
  } = useWorkflowMode()

  return (
    <div
      className="absolute top-7 left-0 z-10 flex h-0 w-full items-center justify-between bg-mask-top2bottom-gray-50-to-transparent px-3"
    >
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
