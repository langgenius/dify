import { usePathname } from 'next/navigation'
import {
  useWorkflowMode,
} from '../hooks'
import type { HeaderInNormalProps } from './header-in-normal'
import HeaderInNormal from './header-in-normal'
import type { HeaderInRestoringProps } from './header-in-restoring'
import { useStore } from '../store'
import dynamic from 'next/dynamic'

const HeaderInHistory = dynamic(() => import('./header-in-view-history'), {
  ssr: false,
})
const HeaderInRestoring = dynamic(() => import('./header-in-restoring'), {
  ssr: false,
})

export type HeaderProps = {
  normal?: HeaderInNormalProps
  restoring?: HeaderInRestoringProps
}
const Header = ({
  normal: normalProps,
  restoring: restoringProps,
}: HeaderProps) => {
  const pathname = usePathname()
  const inWorkflowCanvas = pathname.endsWith('/workflow')
  const {
    normal,
    restoring,
    viewHistory,
  } = useWorkflowMode()
  const maximizeCanvas = useStore(s => s.maximizeCanvas)

  return (
    <div
      className='absolute left-0 top-0 z-10 flex h-14 w-full items-center justify-between bg-mask-top2bottom-gray-50-to-transparent px-3'
    >
      {inWorkflowCanvas && maximizeCanvas && <div className='h-14 w-[52px]' />}
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
