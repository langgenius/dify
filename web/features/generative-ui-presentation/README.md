# Dify Generative UI presentation

Run the Web development server with `pnpm -C web dev`, then open
`/presentations/generative-ui`. The seven-slide presentation uses Chinese copy
and Dify design tokens. It does not require a running API.

- Use the arrow keys or footer buttons to advance slides and fragments.
- Use Esc for the overview, S for the speaker view, and F for fullscreen.
- The architecture slide has six reversible data-flow steps.
- The Live Demo slide opens the app list in a new tab. A real application needs
  its usual Dify backend and model setup.
- The preset replay uses a fixed response streamed into the existing Generative UI
  renderer. It is labeled as preset data and does not call a model. Leaving the
  slide stops the replay; reset starts a fresh replay.
- The three scenario scripts appear only in the Live Demo speaker notes.
- Maintain the Chinese speaker notes for all seven slides in `speaker-notes.ts`.

For a static PDF, use the PDF link, then print to PDF in Chrome or Chromium with
landscape orientation, no margins, and background graphics enabled. Fragments
are combined into one final state per slide.

`deck.tsx` owns slide composition and reveal.js navigation. `architecture.tsx`
owns the diagram and fragment groups. `demo.tsx` owns live-demo navigation and
replay state. `interface-preview.tsx` renders the preset response through the
existing Generative UI renderer. Presentation styles are scoped to the deck.
