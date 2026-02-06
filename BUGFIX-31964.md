# Bug Fix for Issue #31964: Metadata Batch Edit Doesn't Work

## Problem Analysis

### Root Cause
When users select documents across multiple pages and try to batch edit metadata, the operation fails silently because:

1. `documents` prop contains only the current page's documents (paginated data)
2. `selectedIds` may contain document IDs from other pages
3. The filtered `docList` only includes documents from the current page
4. When `formateToBackendList` iterates over `selectedDocumentIds`, it can't find documents from other pages
5. This results in `docIndex = -1` and empty `oldMetadataList`, causing the update to fail

### Code Location
File: `web/app/components/datasets/documents/components/list.tsx`

```typescript
// Current problematic code (line ~95)
const {
  isShowEditModal,
  showEditModal,
  hideEditModal,
  originalList,
  handleSave,
} = useBatchEditDocumentMetadata({
  datasetId,
  docList: documents.filter(doc => selectedIds.includes(doc.id)), // ❌ Only current page
  selectedDocumentIds: selectedIds, // ✅ All selected IDs
  onUpdate,
})
```

## Solution

### Option 1: Fetch Full Document Data (Recommended)
Modify the hook to fetch complete document data for all selected IDs before processing.

**Changes needed in `use-batch-edit-document-metadata.ts`:**

```typescript
import { useDocumentMetaData } from '@/service/knowledge/use-metadata'

const useBatchEditDocumentMetadata = ({
  datasetId,
  docList,
  selectedDocumentIds,
  onUpdate,
}: Props) => {
  // Fetch metadata for documents not in docList
  const missingDocIds = selectedDocumentIds?.filter(
    id => !docList.find(doc => doc.id === id)
  ) || []
  
  // Fetch missing documents' metadata
  const missingDocsQueries = missingDocIds.map(docId => 
    useDocumentMetaData({ datasetId, documentId: docId })
  )
  
  // Combine current page docs with fetched docs
  const completeDocList = useMemo(() => {
    const fetchedDocs = missingDocsQueries
      .filter(q => q.data)
      .map(q => ({
        id: q.data!.id,
        doc_metadata: q.data!.doc_metadata,
      }))
    return [...docList, ...fetchedDocs]
  }, [docList, missingDocsQueries])
  
  // Use completeDocList instead of docList in metaDataList
  // ... rest of the code
}
```

### Option 2: Partial Update Mode (Simpler)
Use the existing `partial_update` flag more intelligently.

**Changes in `use-batch-edit-document-metadata.ts`:**

```typescript
const formateToBackendList = (
  editedList: MetadataItemWithEdit[], 
  addedList: MetadataItemInBatchEdit[], 
  isApplyToAllSelectDocument: boolean
) => {
  const documentIds = selectedDocumentIds || docList.map(doc => doc.id)
  
  const res: MetadataBatchEditToServer = documentIds.map((documentId) => {
    const docIndex = docList.findIndex(doc => doc.id === documentId)
    const isDocumentInCurrentPage = docIndex >= 0
    const oldMetadataList = isDocumentInCurrentPage ? metaDataList[docIndex] : []
    
    // ... existing logic ...
    
    return {
      document_id: documentId,
      metadata_list: newMetadataList,
      partial_update: !isDocumentInCurrentPage, // ✅ Set true for cross-page docs
    }
  })
  return res
}
```

### Option 3: API-Level Fix (Backend)
Ensure the backend API handles `partial_update: true` correctly when document metadata is missing.

## Testing Plan

1. **Single Page Selection**: Select 2-3 documents on one page, edit metadata → Should work
2. **Cross-Page Selection**: 
   - Go to page 1, select 2 documents
   - Go to page 2, select 2 more documents
   - Click metadata batch edit → Should work for all 4 documents
3. **Edge Cases**:
   - Select all documents across multiple pages
   - Edit metadata with mixed values (some docs have field, some don't)
   - Add new metadata fields in batch edit

## Recommended Approach

**Option 2 (Partial Update Mode)** is the simplest and most pragmatic:
- Minimal code changes
- Leverages existing `partial_update` flag
- Backend should already handle this case
- No additional API calls needed

## Implementation Steps

1. Modify `formateToBackendList` in `use-batch-edit-document-metadata.ts`
2. Add proper handling for `partial_update: true` case
3. Add success toast notification (currently missing)
4. Test cross-page selection scenarios
5. Submit PR with test cases

## Additional Improvements

While fixing this bug, consider:
1. **Add loading state** during batch update
2. **Show success notification** (currently missing in the code)
3. **Validate backend response** and handle errors gracefully
4. **Add unit tests** for cross-page selection scenarios
