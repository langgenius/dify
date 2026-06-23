import type { IconData } from '@/app/components/base/icons/IconBase'
import * as React from 'react'
import IconBase from '@/app/components/base/icons/IconBase'
import data from './SidebarLeftArrowIcon.json'

const SidebarLeftArrowIcon = (
  {
    ref,
    ...props
  }: React.SVGProps<SVGSVGElement> & {
    ref?: React.RefObject<React.RefObject<HTMLOrSVGElement>>
  },
) => <IconBase {...props} ref={ref} data={data as IconData} />

SidebarLeftArrowIcon.displayName = 'SidebarLeftArrowIcon'

export default SidebarLeftArrowIcon
