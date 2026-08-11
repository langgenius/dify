import type { AutocompleteChangeEventDetails } from '@langgenius/dify-ui/autocomplete'
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemText,
  AutocompleteList,
  AutocompleteStatus,
} from '@langgenius/dify-ui/autocomplete'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InfiniteScrollSentinel } from '@/app/components/base/infinite-scroll-sentinel'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'

const EDUCATION_AUTOCOMPLETE_PAGE_SIZE = 40

type InstitutionFieldProps = {
  value: string
  onValueChange: (value: string) => void
}

const InstitutionField = ({ value, onValueChange }: InstitutionFieldProps) => {
  const { t } = useTranslation()
  const inputId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)
  const hasSearchQuery = !!searchQuery
  const isDebouncing = hasSearchQuery && searchQuery !== debouncedSearchQuery
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
    isPending,
    isPlaceholderData,
    isSuccess,
  } = useInfiniteQuery({
    ...consoleQuery.account.education.autocomplete.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          keywords: debouncedSearchQuery,
          limit: EDUCATION_AUTOCOMPLETE_PAGE_SIZE,
          page: Number(pageParam),
        },
      }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, pages) =>
        lastPage.has_next ? (lastPage.curr_page ?? pages.length - 1) + 1 : undefined,
    }),
    enabled: hasSearchQuery && !!debouncedSearchQuery,
    placeholderData: keepPreviousData,
  })
  const suggestions = hasSearchQuery ? (data?.pages.flatMap((page) => page.data ?? []) ?? []) : []
  const isSearching = isDebouncing || isPending || (isFetching && !isFetchingNextPage)
  const isLoading = isSearching || isFetchingNextPage
  const shouldOpenPopup = isPopupOpen && hasSearchQuery
  const shouldShowEmpty = shouldOpenPopup && isSuccess && !isLoading && suggestions.length === 0
  const shouldAnnounceLoading = shouldOpenPopup && isLoading
  const shouldShowError = shouldOpenPopup && isError && !isLoading
  const shouldShowFooter = shouldOpenPopup && (isLoading || hasNextPage || shouldShowError)
  const canLoadMore =
    shouldOpenPopup && !isDebouncing && !isPlaceholderData && !isFetching && !isFetchNextPageError

  const handleValueChange = (inputValue: string, eventDetails: AutocompleteChangeEventDetails) => {
    onValueChange(inputValue)
    if (eventDetails.reason === 'item-press') {
      setSearchQuery('')
      setIsPopupOpen(false)
      return
    }

    setSearchQuery(inputValue)
    setIsPopupOpen(!!inputValue)
  }

  return (
    <Field name="institution" className="mb-7">
      <FieldLabel
        className="flex h-6 items-center py-0 system-md-semibold text-text-secondary"
        htmlFor={inputId}
      >
        {t(($) => $['form.schoolName.title'], { ns: 'education' })}
      </FieldLabel>
      <Autocomplete
        items={suggestions}
        value={value}
        onValueChange={handleValueChange}
        filter={null}
        mode="list"
        open={shouldOpenPopup}
        onOpenChange={setIsPopupOpen}
      >
        <AutocompleteInputGroup size="large">
          <AutocompleteInput
            id={inputId}
            size="large"
            placeholder={t(($) => $['form.schoolName.placeholder'], { ns: 'education' })}
          />
        </AutocompleteInputGroup>
        <AutocompleteContent
          popupClassName="w-(--anchor-width) max-w-(--available-width)"
          portalProps={{ keepMounted: true }}
          popupProps={{ 'aria-busy': isLoading || undefined }}
        >
          <AutocompleteList ref={listRef}>
            <AutocompleteCollection<string>>
              {(institution) => (
                <AutocompleteItem key={institution} value={institution} title={institution}>
                  <AutocompleteItemText>{institution}</AutocompleteItemText>
                </AutocompleteItem>
              )}
            </AutocompleteCollection>
            {shouldShowFooter ? (
              <div
                className="relative flex h-10 items-center justify-center px-3"
                aria-hidden="true"
              >
                {hasNextPage ? (
                  <InfiniteScrollSentinel
                    className="absolute inset-x-0 top-0"
                    canLoadMore={canLoadMore}
                    onLoadMore={() => {
                      void fetchNextPage({ cancelRefetch: false })
                    }}
                    preloadDistance={5}
                    scrollContainerRef={listRef}
                  />
                ) : null}
                {shouldShowError ? (
                  <span className="system-sm-regular text-text-destructive">
                    {t(($) => $['dynamicSelect.error'], { ns: 'common' })}
                  </span>
                ) : (
                  <Loading className="h-10" />
                )}
              </div>
            ) : null}
          </AutocompleteList>
          <AutocompleteEmpty>
            {shouldShowEmpty ? t(($) => $['form.schoolName.noResults'], { ns: 'education' }) : null}
          </AutocompleteEmpty>
          <AutocompleteStatus className="p-0">
            <span className="sr-only">
              {shouldAnnounceLoading
                ? t(($) => $.loading, { ns: 'common' })
                : shouldShowError
                  ? t(($) => $['dynamicSelect.error'], { ns: 'common' })
                  : null}
            </span>
          </AutocompleteStatus>
        </AutocompleteContent>
      </Autocomplete>
    </Field>
  )
}

export default InstitutionField
