import { createMathPlugin } from '@streamdown/math'
import { ENABLE_SINGLE_DOLLAR_LATEX } from '@/config'

export const mathPlugins = {
  math: createMathPlugin({ singleDollarTextMath: ENABLE_SINGLE_DOLLAR_LATEX }),
}
