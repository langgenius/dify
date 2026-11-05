import type { Window } from 'happy-dom'

const DEFAULT_VIEWPORT_WIDTH = 1024

// happy-dom evaluates `window.matchMedia` against its own viewport, so stubbing `innerWidth` has no effect.
export const setViewportWidth = (width: number) => {
  ;(window as unknown as Window).happyDOM.setViewport({ width })
}

export const resetViewportWidth = () => setViewportWidth(DEFAULT_VIEWPORT_WIDTH)
