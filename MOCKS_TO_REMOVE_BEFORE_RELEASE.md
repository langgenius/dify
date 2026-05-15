# Mocks to Remove Before Release

- `emptyAppList=true`: frontend URL preview flag for forcing the `/apps` page into the first-empty state. Remove the parser and rendering override before release.
- `emptyDataList=true`: frontend URL preview flag for forcing the `/datasets` page into the first-empty state. Remove the parser and rendering override before release.
- Home page `Continue work with`: still uses mock data. Replace it with API-backed data before release.
