// GENERATE BY script
// DON NOT EDIT IT MANUALLY

import * as React from 'react'
import data from './FileCode.json'
import IconBase from '@/app/components/base/icons/IconBase'
import type { IconBaseProps, IconData } from '@/app/components/base/icons/IconBase'

const Icon = React.forwardRef<React.MutableRefObject<SVGElement>, Omit<IconBaseProps, 'data'>>((
  props,
  ref,
) => <IconBase {...props} ref={ref} data={data as IconData} />)

Icon.displayName = 'FileCode'

export default Icon
