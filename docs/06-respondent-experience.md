# 06 — Respondent experience

The respondent screen is used both at `/s/:surveyId` and inside the builder's Preview. It must feel fast, calm and modern, and work well on phones first.

## "My surveys" page (`/`)

- Cards grouped: **To do** (with "Closes in 3 days" when relevant), **In progress** (with progress %), **Completed**.
- Each card: cover image thumbnail (or accent colour), title, estimated time ("About 2 minutes" = visible question count × 20 s, rounded), closing date, action button (Start / Continue / View).
- Empty state: "You're all caught up."

## Survey page structure

```
[ Cover: image or accent colour, title, description ]
[ Sticky progress bar: bar + "Question 3 of 8" / "Section 2 of 3" / "4 of 8 answered" ]
[ Body: depends on layout ]
[ Footer: Back / status text / Next or Submit ]
```

- Cover with image: min-height ~190px (150px on phones), white title over the image with the darken overlay, slight text shadow.
- Cover without image: solid accent colour, white text.
- Required questions show a red `*`. Help text sits under the question in muted text.

## Layouts

### All on one page
- All visible questions in order. With 2+ sections, each section shows a header: small uppercase "SECTION 2 OF 3", title, description.
- Submit at the bottom, disabled until every visible required question is answered and there are no range errors. Status text: "2 required questions left" / "All set".
- Progress: "N of M answered" (M = visible questions).

### One section per page
- One section per page with its header. Back / Next. Last page shows Submit.
- Next is disabled until the visible required questions **on that page** are answered: "1 required question left on this page".
- Progress: "Section 2 of 3". Hidden sections are skipped entirely and don't count.
- Scroll to top on page change.

### One question at a time
- One question per screen, larger question text (~21px). With sections, show the section name as a small uppercase label above the question.
- Back / Next, Submit on the last visible question. Next is disabled while the current question is required and unanswered (status "Answer this to continue") or has a range error.
- **Move on automatically** (setting): after a single choice, dropdown or rating answer, go to the next question after ~350 ms.
- Progress: "Question 3 of 8". The total changes as answers show or hide questions; this is expected.
- Transition: short slide-and-fade (≈250 ms) forward and back. Respect `prefers-reduced-motion`.
- **Question navigator** (setting, default on): a row of numbered buttons under the question.
  - Current: outlined in the accent colour. Answered: tinted accent background. Not yet reachable: faded and disabled.
  - People can jump back to any question, but forward **only up to the first unanswered required question** (or first range error).
  - With sections, a small divider separates the groups of numbers.
  - The row scrolls sideways on long surveys and keeps the current number centred.
  - Accessible: `nav aria-label="Questions"`, current button has `aria-current="step"`.

## Inputs (per type)

- **Single choice / Checkboxes:** full-width option cards (label wraps the input), 44px+ tall, accent border and tinted background when selected.
- **Dropdown:** native select styled to match.
- **Rating:** five square buttons (46px), `role="radiogroup"`/`role="radio"`, end labels underneath.
- **Short / Paragraph:** soft filled inputs, accent border on focus.
- **Money:** see `05-survey-builder.md` → Money type.
- New questions revealed by a condition fade in briefly (≈280 ms).

## Saving and submitting

- Autosave answers to `PUT /respond/{id}/draft` about 1.5 s after the last change, and on page hide. Show a subtle "Saved" indicator.
- On load, restore the draft and continue at the first unanswered visible question (one-question layout) or page.
- Submit → `POST /respond/{id}/submit`. On 422, jump to the first question with an error and show it inline.
- **Thank-you screen:** check icon, "Response recorded", "Thanks, your answers have been submitted." plus:
  - One response only: "This survey allows one response per employee, so the form won't open again for you."
  - Editing allowed: "You can change your answers until 24 Nov." with an "Edit response" button.
- Returning after submit shows the same screen.

## Error states

- Not in the audience: "This survey isn't available to you. If you think that's a mistake, contact HR."
- Not open yet: "This survey opens on 10 Nov."
- Closed: "This survey closed on 24 Nov. Thanks for your interest."
- Survey republished while a draft was open: "This survey was updated. Your answers have been kept where possible." Then continue.

## Themes

Applied from the version's `theme`:

- **Accent colour** sets CSS variables on the survey container: `--accent`, `--accent-foreground: #fff`, `--accent-soft: color-mix(in srgb, var(--accent) 16%, var(--background))`. Buttons, progress bar, selected options and navigator use them.
- **Page background:**
  - `none`: normal app background.
  - `color`: a stage behind the survey card filled with that colour.
  - `image`: a stage with the image (`object-fit: cover`), optional blur (`filter: blur(8px)` + `scale(1.08)`), and a black overlay at the darken %. The survey card floats on it with padding (~36px) and a soft shadow.
  - On screens under 640px wide, the background stage is hidden. Only the cover image shows.
- **Cover image:** the image with the darken overlay as a gradient layer. Use the mobile image copy on small screens (`<picture>` / `srcset`).
- The survey card is always a solid surface, so text never sits directly on an image.
- Works in light and dark mode. The theme only changes accent and images, not text colours.

## Accessibility checklist

- Every input has a label (question text). Required state is announced.
- Errors are linked with `aria-describedby` and announced politely.
- Full keyboard use: Tab through options, Space/Enter to select, Enter on Next.
- Focus moves to the question heading after Next/Back.
- Touch targets ≥ 44px. Text contrast meets WCAG AA on the accent colours above.
