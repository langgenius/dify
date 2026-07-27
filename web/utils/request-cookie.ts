export const hasRequestCookie = (cookieHeader: string | undefined, cookieName: string) =>
  Boolean(cookieHeader?.split(';').some((cookie) => cookie.trim().split('=', 1)[0] === cookieName))
