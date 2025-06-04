import {
  useWorkflowMode,
} from '../hooks'
import type { HeaderInNormalProps } from './header-in-normal'
import HeaderInNormal from './header-in-normal'
import type { HeaderInHistoryProps } from './header-in-view-history'
import HeaderInHistory from './header-in-view-history'
import type { HeaderInRestoringProps } from './header-in-restoring'
import HeaderInRestoring from './header-in-restoring'

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
      className='absolute left-0 top-0 z-10 flex h-14 w-full items-center justify-between bg-mask-top2bottom-gray-50-to-transparent px-3'
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
