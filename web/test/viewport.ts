import type { Window } from 'happy-dom'

export const setViewportWidth = (width: number) => {
  ;(window as unknown as Window).happyDOM.setViewport({ width })
}

export const resetViewportWidth = () => setViewportWidth(1024)
