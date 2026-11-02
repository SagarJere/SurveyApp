# UI prototype notes

`ui-prototype.html` is the visual and behavioural reference for the builder, theme, settings, audience and preview screens. Open it in a browser. It is a single-file mock-up with fake data and no server, so it is a reference, not code to reuse.

Use it for **look and interaction**: layout, spacing, colours, wording, what each control does. Use `docs/01–07` for **rules**: validation, storage, permissions, limits. When the two disagree, the docs win unless a line below says otherwise.

## Decisions taken from the prototype (2026-11-02)

- **Product name:** Pulse, with the check-mark logo on an accent tile.
- **Fonts:** Bricolage Grotesque for headings and Figtree for body text, self-hosted with `@fontsource-variable` packages. No calls to Google Fonts.
- **Colours:** the prototype's palette is the app theme. It is defined in `frontend/src/index.css`, which also maps each prototype colour to its token name. Conditions use the violet `logic` colours. Broken conditions, the required `*` and rows to fix use the orange `warn` colours.
- **Toasts:** bottom centre, with an Undo action where the prototype has one.

## Where the docs win

| Topic | Prototype | Follow |
|---|---|---|
| Default layout for new surveys | Sample survey uses "One section per page" | "One question at a time" (`01-requirements.md`) |
| Employee ID check | A row says "ID format isn't recognised" | No format rule. Reject only empty IDs, IDs with spaces and IDs over 30 characters (`04-api.md`) |
| Option labels | Needs 2 non-empty options | Also unique labels (`04-api.md`) |
| Autosave delay | Fake, 650 ms | 800 ms debounce with 409 conflict handling (`05-survey-builder.md`) |
| Amount in words | Hand-written JavaScript | Shared helpers in TS and Python. The backend uses `num2words`. Both must give the same output for the test values in `05-survey-builder.md` |
| Uploads and audience data | Fake, kept in the browser | Real endpoints (`04-api.md`) |
| Accent text inside a survey | White | White in both light and dark mode (`06-respondent-experience.md`). Only the app's own buttons use dark text on teal in dark mode |

## Sample survey: "Workplace pulse, Q4 2026"

Phase 2 is done when HR can build this survey. Description: "Five quick questions about how and where you work. Takes about two minutes."

**Section 1. Your work setup**: "How and where you work most weeks."

| # | Type | Question | Required | Options or settings | Shown when |
|---|---|---|---|---|---|
| Q1 | Rating 1–5 | How satisfied are you with your current work setup? Help: "1 is very unsatisfied, 5 is very satisfied." | yes | | always |
| Q2 | Single choice | Which work mode do you follow most weeks? | yes | Office, full-time · Hybrid · Remote | always |
| Q3 | Single choice | How many days a week are you in the office? | yes | 1–2 days · 3–4 days | Q2 is "Hybrid" |
| Q4 | Checkboxes | What would make remote work easier for you? Help: "Pick all that apply." | no | Better laptop · Second monitor · Faster VPN · Ergonomic chair | Q2 is "Remote" |
| Q5 | Money | Roughly how much have you spent setting up your home workspace this year? Help: "An estimate is fine." | no | INR, no minimum, maximum ₹5,00,000, no paise | Q2 is not "Office, full-time" |
| Q6 | Single choice | Do you manage a team? | yes | Yes, I manage people · No | always |

**Section 2. Leading your team**: "Only for people managers." Shown when Q6 is "Yes, I manage people".

| # | Type | Question | Required | Options |
|---|---|---|---|---|
| Q7 | Rating 1–5 | How satisfied are you with the support you can give your team? | yes | |
| Q8 | Checkboxes | What would help you lead your team better? Help: "Pick all that apply." | no | More in-office days together · Better collaboration tools · Manager training |

**Section 3. Final thoughts**

| # | Type | Question | Required |
|---|---|---|---|
| Q9 | Paragraph | Anything else you'd like HR to know? | no |

**Settings in the sample:** one response per employee on, editing off, anonymous off, opens 10 Nov 2026, closes 24 Nov 2026. **Theme:** Ocean cover and background, blur on, darken 25%, Teal accent.

The "Condition test cases" in `05-survey-builder.md` use their own numbering. They are separate test fixtures, not this survey.

## Reference values

- **Accent swatches:** Teal #0E7A6A, Blue #2457A6, Violet #6447C2, Rose #B42F5B, Amber #9A5B00, Green #3A7D2C.
- **Background colours:** #E8EEF3, #F2ECE3, #E4EFEA, #ECE7F6, #1E2833, #13302C.
- **Gallery names, seeded in Phase 3:** Ocean, Dawn, Forest, Sand, Waves, Blueprint, Dots, Celebration. The prototype draws them with CSS gradients. The real app seeds 8 images.
- **Currencies:** INR ₹ (rupee/paise, adds "only"), USD $ (dollar/cent), EUR € (euro/cent), GBP £ (pound/pence), AED (dirham/fils).
