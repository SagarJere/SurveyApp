# 05 — Survey builder

Visual reference: `docs/reference/ui-prototype.html` (Questions, Theme, Settings and Audience tabs, Edit/Preview toggle). Match its layout and behaviour; restyle with shadcn/ui and Tailwind.

## Screen layout

- **Top bar (sticky):** app mark, survey title, status pill (`Draft` / `Published v2`), autosave state ("Saving…" / "All changes saved"), **Edit / Preview** toggle, primary button.
  - Primary button text: `Publish` (draft) → `Published` (disabled, no changes) → `Publish changes` (published with unpublished edits).
- **Tabs (edit mode):** Questions · Theme · Settings · Audience.
- **Content column:** max width ~760px, centred. On phones it uses the full width with 12px side padding.

## Builder state

- One Zustand store holds the draft (same shape as `surveys.draft` in `03-data-model.md`) plus UI state (open question, collapsed sections, type picker open, last deleted item for Undo).
- **Autosave:** debounce 800 ms after the last change → `PUT /surveys/{id}/draft` with `draft_updated_at`. On 409, show "Someone else edited this survey" with Reload.
- Typing in a field updates the store but must not re-render the whole list or lose focus.

## Survey header card

Editable title (large) and description. Accent-coloured top border.

## Sections

- Every survey has **at least one section**. While there is only one, section UI is hidden and the builder looks like a flat question list.
- **Add section** button sits beside **Add question** at the bottom. Adding the second section titles the first "Section 1" if it has no title.
- With 2+ sections each section shows a header card:
  - "Section 2 of 3" label, editable title and description.
  - Buttons: move up, move down, delete, collapse/expand (collapsed shows "4 questions hidden").
  - "Show this section only when…" → section condition (see Conditions).
  - Its own **Add question** button at the bottom of its questions.
- **Delete section:** its questions move to the previous section (or the next one if it was first). Toast with **Undo**.
- Question numbering is continuous across sections (Q1…Qn).

## Question cards

**Collapsed:** number (`Q3`), question text (or "Untitled question"), type label, `*` if required, and a condition tag above it if conditional.

**Expanded (one at a time):**
- Question text (textarea) + type dropdown.
- Help text (optional, single line).
- Type-specific editor (see below).
- Condition panel if a condition exists.
- "Used in N conditions" note if other items depend on it.
- Footer: **Required** switch, **Add condition**, move up, move down, duplicate, delete.

**Moving:** up/down arrows. At the first/last question of a section, the arrow moves the question into the previous/next section. Drag and drop (dnd-kit) is a nice-to-have on top of the arrows, not a replacement; arrows are needed for keyboard and touch.

**Delete:** toast "Deleted Q3. It was used in 1 condition." with **Undo**. Conditions that pointed at it show as broken.

**Duplicate:** inserts a copy below with new keys for the question and its options, text suffixed "(copy)".

**Add question:** button opens a type picker grid (icon + name for each type). The new question opens with focus in the text field.

## Question types (v1)

| Type | Editor | Respondent input | Condition source? | Condition ops |
|---|---|---|---|---|
| Single choice | option list | radio cards | yes | is, is not |
| Checkboxes | option list | checkbox cards | yes | is (= includes), is not |
| Dropdown | option list | select | yes | is, is not |
| Rating 1–5 | preview of scale | 5 buttons, labels "Very unsatisfied" … "Very satisfied" | yes | is at least, is at most, is greater than, is less than, is equal to, is not equal to |
| Short answer | preview line | text input (max 2,000) | no | — |
| Paragraph | preview area | textarea (max 10,000) | no | — |
| Money | currency, min, max, decimals | formatted amount + words | yes | is at least, is at most, is greater than, is less than, is equal to, is not equal to |
| Number | lowest, highest, decimals, unit | number box + unit | yes | is at least, is at most, is greater than, is less than, is equal to, is not equal to |

**Option list editor:** marker (circle/square/number by type), inline text input per option, remove button (disabled when only one left), "Add option" focuses the new input. Options must be non-empty and unique to publish.

## Money type

**Settings:** Currency (INR ₹, USD $, EUR €, GBP £, AED), Minimum, Maximum, "Allow paise/cents" switch. The editor shows a live example: `₹1,25,000` and "One lakh twenty-five thousand rupees only".

**Respondent input:**
- `inputmode="decimal"` text input with the currency symbol inside on the left.
- Formats while typing and keeps the caret in the right place:
  - INR uses Indian grouping: `12,34,567`.
  - Others use international grouping: `1,234,567`.
- Accepts digits and one decimal point (only if decimals are allowed, max 2 decimal places). Max 13 integer digits.
- Below the input, live amount in words (`aria-live="polite"`):
  - INR: "Twelve lakh thirty-four thousand five hundred sixty-seven rupees and fifty paise only".
  - Others: "One million two hundred fifty thousand dollars and five cents".
  - Singular forms: "One rupee", "one paisa", "one cent".
- Out-of-range values show "Enter ₹5,00,000 or less." and block Next/Submit.

**Storage:** number with 2 decimals (`numeric(14,2)`) plus the currency on the question. Never store the words. Backend generates words with `num2words(amount, lang="en_IN")` for INR and `lang="en"` for others, then adds the currency words.

Shared helpers needed in both TS and Python: `formatAmount(value, currency)`, `amountInWords(value, currency)`. Test with: 0, 1, 1.5, 10, 100000, 125000, 1234567.5, 10000000, 99999999999.99.

## Number type

For counts and measures that aren't money: "How many people are coming?", "How far do you travel?".

**Settings** (prefixed, so switching a question between Money and Number keeps both types' settings):
- `number_min`, `number_max`: lowest and highest allowed, optional, from -999,999,999,999.99 to 999,999,999,999.99. New questions start with lowest 0. Publishing needs lowest ≤ highest.
- `number_decimals`: off = whole numbers only; on = up to 2 decimal places.
- `number_unit`: optional, up to 30 characters, shown after the answer box, in results and in export headings. Used as written ("1 people"): no plurals.

**Respondent input:** a text box that accepts only what the question allows (digits, a minus sign when negatives are allowed, a decimal point when decimals are on, at most 12 digits before the point). It shows Indian digit grouping (12,34,567) when not being edited. Phones get the number keypad, except when negatives are allowed (the iPhone keypad has no minus key). Range messages: "Enter a number from 1 to 10.", "Enter at least 1.", "Enter 10 or less."

**Storage:** `response_answers.value_num` (`numeric(14,2)`), like money. Shared helpers in TS and Python: `formatNumber(value, unit)`, `numberRangeError(config, value)`, tested with `shared/test-cases/number.json`.

**Conditions:** is at least, at most, greater than, less than, equal to or not equal to a number (negatives allowed); default "is at least 1".

## Conditions

**Shape:** `{ "src": "<question key>", "op": "is" | "not" | "gte" | "lte" | "gt" | "lt", "val": "<option key>" | number }`

One condition per question or section in v1. (Later: several conditions with "all"/"any".)

**UI:** sentence builder in a tinted panel:

> Show this **question** only when **[Q2: Which work mode… ▾]** **[is ▾]** **[Hybrid ▾]**

- The source list contains only **earlier** eligible questions (for sections: questions in earlier sections).
- The operator list depends on the source type. The value is a dropdown of that question's options, a 1–5 dropdown for rating, an amount input for money, or a number box for number questions.
- Default on "Add condition": the nearest earlier eligible question, its first operator and first value (money default: 50,000).
- If there is no eligible source: "Add a choice or rating question above this one. Then you can show this question based on its answer."
- Conditional questions are indented with a coloured connector line and a tag: "Shown when Q2 is “Hybrid”".

**Broken conditions** (shown as an orange tag "Condition needs attention" plus an explanation in the panel; they block publishing):
- Source deleted → "The question this depended on was deleted. Pick a new one or remove the condition."
- Source now after this question → "Q5 now comes after this question. Move it back up or change the condition."
- Section condition source in the same or a later section → "Q5 is in this section or a later one…"
- Source type changed to an ineligible type → "Q2 is no longer a choice or rating question. Set the condition again."
- Option removed or operator invalid → "The answer this condition uses changed in Q2. Pick it again."

### Evaluation (same in TS and Python)

```
visible(question) =
    section_visible(question.section)
    AND (no condition OR condition is broken OR (source is visible AND matches(condition)))

section_visible(section) =
    no condition OR condition is broken OR (source is visible AND matches(condition))

matches(c):
    a = answer[c.src]; if not answered(a): false
    rating/money/number: gte → a >= val ; lte → a <= val ; gt → a > val ; lt → a < val ;
                         is → a == val ; not → a != val   (compared in hundredths: 2 decimals)
    choice: hit = (a is list ? val in a : a == val); is → hit ; not → !hit
```

Notes:
- "is not" and "is not equal to" are **false when the source is unanswered**.
- For numeric sources the default comparison is "is at least" (greater than, less than, equal to and not equal to added 2026-11-09).
- Evaluate in display order so a hidden source hides everything that depends on it (chains).
- Broken conditions don't hide things in preview (fail open); publishing is blocked anyway.
- After evaluation, discard answers of hidden questions.

### Condition test cases

Use these in both `survey_logic.py` and `survey-logic/*.test.ts`.

1. Q3 depends on Q2 is Hybrid. Q2 = Hybrid → Q3 visible. Q2 = Remote → hidden. Q2 unanswered → hidden.
2. Q5 depends on Q2 is not "Office". Q2 unanswered → hidden. Q2 = Remote → visible.
3. Chain: Q4 depends on Q3 (rating ≥ 4), Q3 depends on Q2 = Hybrid. Q2 = Remote, Q3 answered 5 earlier → Q3 hidden, Q3 answer discarded, Q4 hidden.
4. Checkboxes: Q8 depends on Q7 is "Laptop". Q7 = [Laptop, VPN] → visible. Q7 = [VPN] → hidden.
5. Money: Q6 depends on Q5 ≥ 50,000. Q5 = 50000 → visible. Q5 = 49999.99 → hidden.
6. Section 2 depends on Q5 is "Yes". Q5 = No → every question in section 2 hidden and their answers discarded, and required questions there don't block submit.
7. A required question that is hidden never blocks submit.
8. Broken condition (source deleted) → item visible in preview, publish returns an issue.

## Theme tab

See `06-respondent-experience.md` → Themes for how it renders. The tab contains:
1. **How it looks:** live mini preview (cover + one question card over the background).
2. **Cover image:** tiles: "Accent colour only", gallery images, uploaded images, "Upload image" tile.
3. **Page background:** segmented None / Colour / Image. Colour → swatches. Image → image tiles + "Soften background" switch.
4. **Darken images:** slider 0–60% in steps of 5, live value.
5. **Accent colour:** 6 swatches (Teal #0E7A6A, Blue #2457A6, Violet #6447C2, Rose #B42F5B, Amber #9A5B00, Green #3A7D2C). Accent text on buttons is white.

## Settings tab

- **Layout:** three option cards with small diagrams: All on one page / One section per page / One question at a time. With one-question selected, show the "Show question navigator" and "Move on automatically" switches.
- **Responses:** One response per employee, Allow editing until the survey closes, Anonymous responses (each with a one-line explanation).
- **Schedule:** opens and closes date pickers.

## Audience tab

- "Open to all employees" switch. When off:
- Upload card: drag-and-drop or choose file (`.xlsx`, `.csv`), "Download template" button.
- After upload: preview with three counts (Employees added / Duplicates skipped / Rows to fix), a table of rows to fix, "Download rows to fix", then **Apply** or **Discard**.
- Current audience: count by department, searchable list, remove button per employee.

## Preview mode

The **Preview** toggle renders the real respondent component (same code as `/s/:id`) with the current draft, conditions working, plus:
- "Phone width" toggle (constrains to 390px).
- "Reset answers".
- No data is saved.

## Publishing

1. Click Publish → `POST /validate`.
2. If there are issues, open the first problem card, scroll to it, and show a toast: "Fix 3 issues before publishing. Q4 needs at least two options."
3. If OK → `POST /publish` → toast "Published. 480 employees can respond from 10 Nov." For later versions: "Published version 2. Earlier responses stay linked to version 1."
