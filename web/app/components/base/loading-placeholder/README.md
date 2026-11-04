# Loading placeholder

`LoadingPlaceholder` replaces an unavailable content slot with a centered 16px Dify UI Spinner.
Its root is a full-width flex container. It does not infer height: the owning page, panel, or list
allocates the space using its existing layout. `className` applies to the placeholder container,
never the spinner. `label` overrides the shared localized loading label.

Use the existing `FullScreenLoading` for viewport-sized application states. Feature-level loading
components own repeated feature geometry and more specific labels. When a surrounding component
already owns the complete placement and semantics, use Spinner or SpinnerIcon directly instead of
adding another placeholder. Buttons own their busy interaction and use decorative artwork.

The placeholder does not own queries, Suspense boundaries, content persistence, `aria-busy`, or
live announcements. The feature decides when it renders and whether a scoped skeleton is more
appropriate. Do not add an `app`/`area` mode or map percentage height and flex growth to one `fill`
flag: those require different containing-block contracts.

During migration, preserve the actual container and artwork dimensions independently. In
particular, a 32px placeholder still contains a 16px spinner. Preserve existing spacing, surface
styles, scroll behavior, and loading-to-content transitions; any deliberate visible correction
must be reviewed separately from the API replacement.
