export function resolveClassName<State>(
  className: string | ((state: State) => string | undefined) | undefined,
  state: State,
) {
  return typeof className === 'function' ? className(state) : className
}
