import type { IconData } from '@/app/components/base/icons/IconBase'
import * as React from 'react'
import IconBase from '@/app/components/base/icons/IconBase'
import data from './Annotations.json'

const Annotations = (
  {
    ref,
    ...props
  }: React.SVGProps<SVGSVGElement> & {
    ref?: React.RefObject<React.RefObject<HTMLOrSVGElement>>
  },
) => <IconBase {...props} ref={ref} data={data as IconData} />

Annotations.displayName = 'Annotations'

export default Annotations
