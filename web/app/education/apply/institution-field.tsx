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
import { useInfiniteQuery } from '@tanstack/react-query'
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
  const isSearchReady = !!searchQuery && searchQuery === debouncedSearchQuery
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isFetchNextPageError,
    isPending,
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
    enabled: isSearchReady,
  })
  const suggestions = isSearchReady ? (data?.pages.flatMap((page) => page.data ?? []) ?? []) : []
  const isLoading = isPending || isFetchingNextPage
  const shouldOpenPopup = isPopupOpen && isSearchReady
  const shouldShowEmpty = shouldOpenPopup && isSuccess && !isLoading && suggestions.length === 0
  const shouldShowLoading = shouldOpenPopup && isLoading
  const shouldShowError = shouldOpenPopup && isError && !isLoading

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
            {hasNextPage ? (
              <InfiniteScrollSentinel
                canLoadMore={shouldOpenPopup && !isFetchingNextPage && !isFetchNextPageError}
                onLoadMore={() => {
                  void fetchNextPage({ cancelRefetch: false })
                }}
                preloadDistance={5}
                scrollContainerRef={listRef}
              />
            ) : null}
          </AutocompleteList>
          <AutocompleteEmpty>
            {shouldShowEmpty ? t(($) => $['form.schoolName.noResults'], { ns: 'education' }) : null}
          </AutocompleteEmpty>
          <AutocompleteStatus className="p-0">
            {shouldShowLoading ? (
              <>
                <span className="sr-only">{t(($) => $.loading, { ns: 'common' })}</span>
                <div aria-hidden="true">
                  <Loading className="h-10" />
                </div>
              </>
            ) : shouldShowError ? (
              <div className="px-3 py-2 text-text-destructive">
                {t(($) => $['dynamicSelect.error'], { ns: 'common' })}
              </div>
            ) : null}
          </AutocompleteStatus>
        </AutocompleteContent>
      </Autocomplete>
    </Field>
  )
}

export default InstitutionField
