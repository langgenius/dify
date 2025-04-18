import {
  useWorkflowMode,
} from '../hooks'
import type { HeaderInNormalProps } from './header-in-normal'
import HeaderInNormal from './header-in-normal'
import HeaderInHistory from './header-in-view-history'
import type { HeaderInRestoringProps } from './header-in-restoring'
import HeaderInRestoring from './header-in-restoring'

export type HeaderProps = {
  normal?: HeaderInNormalProps
  restoring?: HeaderInRestoringProps
}
const Header = ({
  normal: normalProps,
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
          <HeaderInHistory />
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
