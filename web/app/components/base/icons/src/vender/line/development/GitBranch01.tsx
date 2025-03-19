// GENERATE BY script
// DON NOT EDIT IT MANUALLY

import * as React from 'react'
import data from './GitBranch01.json'
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

Icon.displayName = 'GitBranch01'

export default Icon
