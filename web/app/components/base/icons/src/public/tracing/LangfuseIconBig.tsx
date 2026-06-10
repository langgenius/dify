// GENERATE BY script
// DON NOT EDIT IT MANUALLY

import type { IconData } from '@/app/components/base/icons/IconBase'
import * as React from 'react'
import IconBase from '@/app/components/base/icons/IconBase'
import data from './LangfuseIconBig.json'

const Icon = (
  {
    ref,
    ...props
  }: React.SVGProps<SVGSVGElement> & {
    ref?: React.RefObject<React.RefObject<HTMLOrSVGElement>>
  },
) => <IconBase {...props} ref={ref} data={data as IconData} />

Icon.displayName = 'LangfuseIconBig'

export default Icon
