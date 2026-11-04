import { mergeCurrentPageSelectedSegmentIds } from '../use-segment-selection'

describe('mergeCurrentPageSelectedSegmentIds', () => {
  it('should merge current page selection without dropping selected ids from other pages', () => {
    expect(
      mergeCurrentPageSelectedSegmentIds({
        selectedSegmentIds: ['page-1-a', 'page-1-b'],
        currentPageSegmentIds: ['page-2-a', 'page-2-b'],
        nextCurrentPageSelectedSegmentIds: ['page-2-a'],
      }),
    ).toEqual(['page-1-a', 'page-1-b', 'page-2-a'])
  })

  it('should replace only current page selected ids when current page selection changes', () => {
    expect(
      mergeCurrentPageSelectedSegmentIds({
        selectedSegmentIds: ['page-1-a', 'page-2-a', 'page-2-b'],
        currentPageSegmentIds: ['page-2-a', 'page-2-b'],
        nextCurrentPageSelectedSegmentIds: ['page-2-b'],
      }),
    ).toEqual(['page-1-a', 'page-2-b'])
  })
})
