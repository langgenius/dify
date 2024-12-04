import { createTwc } from 'react-twc'
import classNames from './classnames'

export const twc = createTwc({
  compose: classNames,
})
