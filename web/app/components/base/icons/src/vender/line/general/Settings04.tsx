// GENERATE BY script
// DON NOT EDIT IT MANUALLY

import * as React from 'react'
import data from './Settings04.json'
import IconBase from '@/app/components/base/icons/IconBase'
import type { IconBaseProps, IconData } from '@/app/components/base/icons/IconBase'

const Icon = (
  {
    ref,
    ...props
  }: Omit<IconBaseProps, 'data'> & {
    ref: React.RefObject<React.MutableRefObject<SVGElement>>;
  },
) => <IconBase {...props} ref={ref} data={data as IconData} />

Icon.displayName = 'Settings04'

export default Icon
