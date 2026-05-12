type Noop = {
  // eslint-disable-next-line ts/no-explicit-any
  (...args: any[]): any
}

/** @see https://foxact.skk.moe/noop */
export const noop: Noop = () => { /* noop */ }
