import { twMerge } from 'tailwind-merge'
import cn from 'classnames'

const classNames = (...cls: cn.ArgumentArray) => {
  return twMerge(cn(cls))
}

export default classNames
