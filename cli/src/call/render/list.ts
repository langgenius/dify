import type { Renderer } from './index'
import { objectRenderer } from './object'

// A list body (page/limit/total/has_more/data/hints) prints exactly like an
// object body: the parsed JSON re-serialised as one line.
export const listRenderer: Renderer = objectRenderer
