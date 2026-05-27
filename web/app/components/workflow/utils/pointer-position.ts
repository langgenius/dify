export type PointerPosition = {
  pageX: number
  pageY: number
  elementX: number
  elementY: number
}

export const DEFAULT_POINTER_POSITION: PointerPosition = {
  pageX: 0,
  pageY: 0,
  elementX: 0,
  elementY: 0,
}

type ClientPoint = {
  clientX: number
  clientY: number
}

export const getPointerPositionFromEvent = (
  event: ClientPoint,
  container: Element | null | undefined,
): PointerPosition => {
  const rect = container?.getBoundingClientRect()
  const left = rect?.left ?? 0
  const top = rect?.top ?? 0

  return {
    pageX: event.clientX,
    pageY: event.clientY,
    elementX: event.clientX - left,
    elementY: event.clientY - top,
  }
}
