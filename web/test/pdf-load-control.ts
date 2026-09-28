import { createSinglePagePdf } from './fixtures/pdf'

/**
 * Network-boundary control for PDF loading tests.
 *
 * `pdfjs-dist@4.4.168` fetches document bytes from the page context (its
 * `PDFFetchStream` path, selected by `isValidFetchUrl`), so intercepting
 * `fetch` lets a test observe each load attempt and decide what the loader
 * receives. No request leaves the test.
 */
export type PdfLoadControl = {
  /** Number of document load attempts observed so far. */
  loads: number
  /** Serve a valid PDF on every attempt. */
  alwaysSucceed: () => void
  /** Fail every attempt. */
  alwaysFail: () => void
  /** Fail the first `count` attempts, then serve a valid PDF. */
  failThenSucceed: (count?: number) => void
  /** Restore the original `fetch`. */
  restore: () => void
}

/**
 * Intercept loads of `url` and report every attempt.
 *
 * @param url - document URL under control
 * @param drawnText - text drawn on the served page, used to assert recovery
 */
export function controlPdfLoad(url: string, drawnText: string): PdfLoadControl {
  const control: PdfLoadControl = {
    loads: 0,
    alwaysSucceed: () => {},
    alwaysFail: () => {},
    failThenSucceed: () => {},
    restore: () => {},
  }

  const pdfBytes = createSinglePagePdf(drawnText)
  const originalFetch = globalThis.fetch.bind(globalThis)
  let succeedFrom = 1

  const serve = (succeed: boolean) =>
    succeed
      ? new Response(pdfBytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
      : new Response('injected load failure', {
          status: 500,
          statusText: 'Injected load failure',
        })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url

    if (!href || !href.includes(url)) return originalFetch(input as RequestInfo, init)

    control.loads += 1
    return serve(control.loads >= succeedFrom)
  }) as typeof fetch

  control.alwaysSucceed = () => {
    succeedFrom = 1
  }
  control.alwaysFail = () => {
    succeedFrom = Number.POSITIVE_INFINITY
  }
  control.failThenSucceed = (count = 1) => {
    succeedFrom = count + 1
  }
  control.restore = () => {
    globalThis.fetch = originalFetch
  }

  return control
}
