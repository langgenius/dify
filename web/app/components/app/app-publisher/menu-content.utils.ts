export const PUBLISH_SHORTCUT = ['ctrl', '⇧', 'P']

export const getBatchRunLink = (appURL: string) => `${appURL}${appURL.includes('?') ? '&' : '?'}mode=batch`
