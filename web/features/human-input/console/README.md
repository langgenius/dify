# Console Human Input Form

The authenticated session owner within the [Human Input feature].
`/human-input/[formToken]` is the signed-in Console approval page.
It reuses the Console authentication boundary and the existing form
presentation in [form]. Login redirects preserve the form URL. The backend remains the
authority for workspace access and recipient eligibility.

- `form.tsx` owns fetching, submission, expiry, and completion/error states.
- `definition.ts` validates the generated Console response, then maps ordered
  `resolved_form.parts`, field defaults, actions and expiration to the shared UI.
- `links.ts` maps backstage links from Console pause details to this page.
  Public V2 and unrelated links are left unchanged.

Reads and submissions use the generated GET/POST contract for
`/console/api/form/human-input/v2/{form_token}`. Submission sends `inputs` and
`action`. Errors never fall back to the old form endpoint or another auth surface.
No generated contracts or backend code are modified here.

Public `/form/[token]` and `/form-v2/[token]` pages keep their existing behavior.
This Console page retains its current authenticated upload path. Form-scoped
Console upload authorization is a separate pending API contract (WTA-3537);
module consolidation does not implement that authorization or add an endpoint.

[Human Input feature]: ../README.md
[form]: ../form/README.md
