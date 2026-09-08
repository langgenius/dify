# @langgenius/showcase

The "Six months in the open" launch deck, built as a small Vite app on top of
[`@langgenius/dify-ui`]: the same tokens, themes, typography
utilities and primitives (Button, IconButton, Meter, SegmentedControl, Kbd, Tooltip,
Dialog) the product uses, composed into eleven 16:9 slides.

## Run it

```bash
pnpm --filter @langgenius/showcase dev      # http://localhost:5173, hot reload
pnpm --filter @langgenius/showcase build    # dist/ plus a single-file dist/six-months-in-the-open.html
pnpm --filter @langgenius/showcase preview  # serve the build
```

The single-file build opens straight from disk, so it is the one to carry to the venue.

## Presenting

| Key                     | Action                                   |
| ----------------------- | ---------------------------------------- |
| `→` `↓` `Space` `Enter` | Next slide                               |
| `←` `↑` `Backspace`     | Previous slide                           |
| `Home` / `End`          | First / last slide                       |
| `F`                     | Toggle fullscreen                        |
| `T`                     | Toggle light / dark theme                |
| `D`                     | Open the table view of the current slide |

The stage is a fixed 1920×1080 canvas letterboxed into the window, so the layout is identical on
a laptop and on a projector. The bottom chrome fades out after three seconds without input and
comes back on any pointer or key event. Slides are linkable: `#7` opens slide seven.

## Where the numbers live

Every figure is declared once in [`src/deck/figures.ts`]. Slides read from
it, derived values (per-release, per-day, remainders) are computed there, and the table view
(`D`) renders the same object, so a slide and its data can never disagree. Release dates are the
stable GitHub releases of `langgenius/dify` published between 1 March and 31 August 2026.

## Charts

Charts are plain DOM and SVG written against Dify tokens, following one rule set: marks wear the
brand accent or a de-emphasis grey, text always wears text tokens, every chart with two series
has a legend, and every chart has a table-view twin. Forms used:

- Stat tiles and hero figures for headline counts (values count up on entrance).
- A release timeline on a real calendar axis, with leader lines when labels would collide.
- Unit charts (one square or dot per item) for the 256 improvements, the 117 runtime
  improvements and the 1,200 merged pull requests.
- A segmented Dify `Meter` for "9 of 10 releases" and a ring meter for the community share of
  test code.

[`@langgenius/dify-ui`]: ../dify-ui/README.md
[`src/deck/figures.ts`]: src/deck/figures.ts
