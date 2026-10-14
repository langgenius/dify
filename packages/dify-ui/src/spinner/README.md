# Spinner

`Spinner` is a named, indeterminate progress indicator built on Base UI Progress. Supply exactly
one accessible name through `aria-label` or `aria-labelledby`. Localization belongs to the
consumer. The component fixes `value` to `null` and omits value text rather than exposing Base UI's
English indeterminate fallback. It does not announce completion or manage the surrounding region's
busy state; those belong to the feature's status owner.

`SpinnerIcon` is the same decorative artwork for controls that already own their loading state and
accessible name. It is always hidden from assistive technology. Do not place a second progress
indicator inside a loading button.

Both exports occupy only their own size (12, 16, or 20 pixels; default 16). `className` styles that
size and color, not an enclosing page or panel. The four-square artwork uses a two-second opacity
cycle and a still frame for reduced motion. Its default color is blue in both themes.

Consumers own loading placeholders, page geometry, translations, and data readiness. Do not add
`app`, `area`, fullscreen, centering, request, delay, or content-replacement props here.
