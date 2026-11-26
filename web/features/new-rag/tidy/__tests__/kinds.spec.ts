import {
  FILTERABLE_STATUSES,
  FINDING_KINDS,
  FINDING_STATUSES,
  FINDING_TABS,
  kindsOfTab,
  tabShows,
} from '../kinds'

describe('finding registry', () => {
  it('puts every kind on exactly one tab besides the one that shows everything', () => {
    expect(FINDING_TABS).toEqual(['all', 'conflict', 'overlap'])
    for (const kind of Object.keys(FINDING_KINDS) as Array<keyof typeof FINDING_KINDS>) {
      expect(FINDING_TABS.filter((tab) => tabShows(tab, kind))).toEqual([
        'all',
        FINDING_KINDS[kind].section,
      ])
    }
  })

  it('asks the API for each kind of a tab, exact copies before overlapping documents', () => {
    expect(kindsOfTab('all')).toEqual([])
    expect(kindsOfTab('conflict')).toEqual(['conflict'])
    expect(kindsOfTab('overlap')).toEqual(['duplicate', 'similar'])
  })

  it('offers every status the API can filter by, outdated decisions included', () => {
    expect(FILTERABLE_STATUSES).toEqual(['open', 'dismissed', 'reviewed', 'disabled', 'outdated'])
    expect(FILTERABLE_STATUSES).toEqual(Object.keys(FINDING_STATUSES))
  })
})
