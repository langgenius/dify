# Page Landmarks

Web owns landmark composition across route layouts and feature components. Use the
[W3C landmark guide] for role semantics and the Dify UI [naming contract] for accessible
names. This guide records how those contracts apply to Web pages.

## Page Ownership

- Place perceivable page content in meaningful landmark regions and check coverage after
  composing the layout and its children.
- Trace the parent layouts before adding a page-level landmark. Inspect the composed
  page, including parallel route slots and portals, rather than judging a component alone.
- [MainNavLayout] provides the console's `main` and skip-navigation target. Descendant
  pages and editors must not create another `main`. Hiding the main navigation does not
  remove this wrapper. A route outside this layout must establish its own main-content
  boundary in its owning layout or page.
- Keep the skip link and its target under the same layout owner. Preserve the target ID
  and focus behavior when changing wrappers; a landmark role alone does not move focus.
- Keep page and section headings meaningful inside these boundaries. A heading does not
  create a landmark or automatically name its surrounding section.

## Choose Roles by Content

- Use `nav` for a meaningful group of navigation links. A grid of resource cards is not
  automatically navigation merely because its cards can open detail pages.
- A visual sidebar is not automatically complementary content. File controls, editors,
  and builder or version panels are parts of the current task. Use ordinary containers
  or named sections according to their navigation value. Follow APG's recommendation
  to keep genuine complementary landmarks at the top level.
- Reserve named `section` regions for content useful to reach directly. Avoid turning
  every wrapper, card, or modal body into a landmark. Prefer an existing visible heading
  as the naming source, following the [naming contract].
- Give repeated landmarks distinct names by purpose unless their content and purpose
  are identical. Keep names localized and avoid repeating the role in the name.
- Page-level `header` and `footer` can expose `banner` and `contentinfo`. Their implicit
  roles depend on ancestors; local panel headers and footers do not necessarily expose
  those landmarks. Check the composed context before adding explicit roles.

## Verify the Composed Page

- Check the main-content boundary, landmark hierarchy, names, and heading relationships
  in the relevant loaded, empty, collapsed, and open-overlay states. Exclude hidden
  skeletons from the exposed landmark inventory. Check that label references still
  resolve when conditional content changes.
- When changing a semantic element, inspect affected unit tests and E2E locators,
  including CSS selectors such as `closest('main')`. Locate the intended feature or
  control instead of relying on an extra page landmark or positional selection among
  duplicate landmarks.
- Follow [Web testing policy] for regression coverage. At composition boundaries, keep
  the components that own landmark semantics real; a mocked sidebar cannot prove the
  real sidebar's role. Distinguish DOM assertions and Cucumber dry-runs from actual
  browser or assistive-technology verification.

[MainNavLayout]: ../app/components/main-nav/layout.tsx
[W3C landmark guide]: https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions
[Web testing policy]: test.md
[naming contract]: ../../packages/dify-ui/docs/accessible-names-and-descriptions.md
