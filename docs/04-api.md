# 04 — API (FastAPI)

Base path `/api`. All endpoints except login need `Authorization: Bearer <jwt>`. Responses are JSON. Errors use:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Fix 2 issues before publishing.", "details": { "issues": [ { "question_key": "…", "message": "Q3 needs at least two options" } ] } } }
```

Roles: **E** = employee, **H** = HR, **A** = admin. "Member" = owner/co-owner of that survey (viewer where stated).

## Auth

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | Dev: `{employee_id}`. SSO: provider-specific. Returns `{access_token, user: {employee_id, name, role}}` |
| GET | `/auth/me` | E H A | Current user from the token |

## Surveys (HR/Admin)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/surveys` | H A | Surveys the user is a member of (admin: all). Each item: id, title, status, version_no, response_count, audience_count, response_rate, opens_at, closes_at, has_unpublished_changes |
| POST | `/surveys` | H A | Creates an empty draft with one section. Returns the survey |
| GET | `/surveys/{id}` | member | Survey + draft + settings summary |
| PUT | `/surveys/{id}/draft` | owner/co-owner | Body: full draft JSON + `draft_updated_at` from last read. **409** if someone else saved in between. Returns new `draft_updated_at` |
| POST | `/surveys/{id}/validate` | owner/co-owner | Runs publish validation without publishing. Returns `{issues: []}` |
| POST | `/surveys/{id}/publish` | owner/co-owner | Validates, creates a version, sets status `published`. 422 with all issues if invalid |
| POST | `/surveys/{id}/close` | owner/co-owner | Sets status `closed` |
| POST | `/surveys/{id}/duplicate` | member | New draft copied from current draft |
| DELETE | `/surveys/{id}` | owner | Only if never published |
| GET | `/surveys/{id}/members` | member | |
| PUT | `/surveys/{id}/members` | owner | Replace co-owners/viewers |

### Publish validation rules
- At least one question.
- Every question has text. Choice types have at least 2 non-empty options with unique labels.
- Money: if both set, `min <= max`.
- Number: if both set, `number_min <= number_max`.
- Conditions: the source exists, comes **earlier** (questions: earlier in order; sections: in an earlier section), is a valid source type, the operator fits the type, and the value exists (option key) or is numeric (rating, money, number).
- Opens date before closes date if both set.
- Audience not empty unless `open_to_all`.
- Anonymous with audience < 10: return a **warning** (not blocking).

## Theme assets

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/theme-assets/gallery` | H A | Company gallery images |
| POST | `/surveys/{id}/theme-assets` | owner/co-owner | multipart upload. JPG/PNG/WebP, ≤ 2 MB. Server converts to WebP (max 2400px wide) + mobile copy (800px). Returns `{id, url, mobile_url}` |
| GET | `/files/{asset_id}` and `/files/{asset_id}/mobile` | any logged-in | Serves the image |

## Audience

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/surveys/{id}/audience/template` | H A | Downloads `audience_template.xlsx` |
| POST | `/surveys/{id}/audience/uploads?mode=append\|replace` | owner/co-owner | multipart `.xlsx`/`.csv`. Parses and validates, stores a **preview**. Returns `{upload_id, valid_count, duplicate_count, error_count, errors: [...]}` |
| GET | `/surveys/{id}/audience/uploads/{upload_id}/errors.xlsx` | owner/co-owner | Rows to fix |
| POST | `/surveys/{id}/audience/uploads/{upload_id}/apply` | owner/co-owner | Applies the preview. `replace` only allowed before first publish |
| GET | `/surveys/{id}/audience?search=&department=&page=` | member | Paged list + counts by department |
| DELETE | `/surveys/{id}/audience/{employee_id}` | owner/co-owner | 409 if they already responded |
| PUT | `/surveys/{id}/audience/open-to-all` | owner/co-owner | `{open_to_all: bool}` |

### Import rules
- Accept `.xlsx` and `.csv`. Header names are case-insensitive. `EmployeeId` is required.
- Normalise IDs (trim, uppercase). Invalid: empty ID, ID with spaces inside, ID longer than 30 chars, invalid email format (if provided). There is no other ID format rule (agreed 2026-11-02).
- Duplicates in the file: keep the first, count the rest as duplicates. In `append` mode, IDs already in the audience are counted as duplicates.
- Max 20,000 rows per file.

## Respondent

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/me/surveys` | E | Surveys the user can take: `pending`, `in_progress`, `submitted`, plus closing dates |
| GET | `/respond/{survey_id}` | E (in audience or open to all) | Returns the **current version** (sections, questions, options, settings, theme), plus `participation: {status, draft_answers, can_edit}`. 403 if not in audience, 410 if closed or not open yet |
| PUT | `/respond/{survey_id}/draft` | E | Autosave `{answers}` keyed by question key. Debounced by the client (~1.5 s) |
| POST | `/respond/{survey_id}/submit` | E | `{answers}`. Server evaluates visibility, drops hidden answers, validates required and ranges, writes response + answers + shown rows + participation in **one transaction**. 409 if already submitted and editing isn't allowed. 422 with per-question errors |
| GET | `/respond/{survey_id}/my-response` | E | Their submitted answers (not available for anonymous surveys) |

### Answer payload

```jsonc
{
  "answers": {
    "<question_key>": "<option_key>",                 // single, dropdown
    "<question_key>": ["<option_key>", "<option_key>"],// multi
    "<question_key>": 4,                                // rating
    "<question_key>": 125000.00,                        // money
    "<question_key>": 3,                                // number (whole, or up to 2 decimals)
    "<question_key>": "free text"                       // short, long
  }
}
```

If the survey was republished while someone had a draft, map draft answers to the new version by question and option **key**, drop answers whose question no longer exists, and tell the client so it can show a notice.

## Results

All take the same filter query params: `department`, `location`, `from`, `to`, `version` (default: all versions with the same questions), and `q_<question_key>=<option_key>` to filter by an answer.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/surveys/{id}/results/summary` | member incl. viewer | Headline figures, `small_group: bool` |
| GET | `/surveys/{id}/results/timeline` | member | Responses per day |
| GET | `/surveys/{id}/results/participation` | member | Per department: invited, responded, rate |
| GET | `/surveys/{id}/results/questions` | member | One block per question: shown, answered, plus type-specific stats (see `07-reports-dashboard.md`) |
| GET | `/surveys/{id}/results/comments?question_key=&search=&page=` | member | Text answers with department (never names for anonymous) |
| GET | `/surveys/{id}/results/responses?page=` | member | Individual responses. **403 for anonymous surveys** |
| GET | `/surveys/{id}/results/non-responders.xlsx` | owner/co-owner | Audience members who haven't submitted. Allowed for anonymous surveys too, because it uses participation only and never shows answers |
| GET | `/surveys/{id}/results/export.xlsx?kind=responses\|analytics` | member | `responses`: one Responses sheet. `analytics` (default): Summary with charts, Participation, Responses per day, Responses, Comments. Money columns include an "in words" column |

**Small-group rule (anonymous surveys only):** if a filter leaves fewer than 5 responses, return headline counts only, with `small_group: true` and no answer data.

Cache results endpoints for 60 seconds per survey + filter combination. Invalidate on submit.
