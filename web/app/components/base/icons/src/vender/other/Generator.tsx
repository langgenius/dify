// GENERATE BY script
// DON NOT EDIT IT MANUALLY

import * as React from 'react'
import data from './Generator.json'
import IconBase from '@/app/components/base/icons/IconBase'
import type { IconData } from '@/app/components/base/icons/IconBase'

const Icon = (
  {
    ref,
    ...props
  }: React.SVGProps<SVGSVGElement> & {
    ref?: React.RefObject<React.MutableRefObject<HTMLOrSVGElement>>;
  },
) => <IconBase {...props} ref={ref} data={data as IconData} />

Icon.displayName = 'Generator'

export default Icon
