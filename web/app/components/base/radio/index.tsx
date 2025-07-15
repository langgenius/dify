import type React from 'react'
import type { IRadioProps } from './component/radio'
import RadioComps from './component/radio'
import Group from './component/group'

type CompoundedComponent = {
  Group: typeof Group
} & React.ForwardRefExoticComponent<IRadioProps & React.RefAttributes<HTMLElement>>

const Radio = RadioComps as CompoundedComponent
/**
 * Radio 组件出现一般是以一组的形式出现
 */
Radio.Group = Group
export default Radio
