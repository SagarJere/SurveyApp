# 03 — Data model (PostgreSQL)

All primary keys are UUIDs unless noted. All timestamps are `timestamptz` in UTC. Create everything through Alembic migrations.

## Key design decisions

1. **Draft vs published.** The builder edits one JSONB document (`surveys.draft`). Publishing validates it and copies it into normalized, read-only version tables. Reports and responses only ever read version tables.
2. **Stable question keys.** Each question and section has a `key` (UUID created in the draft) that stays the same across versions. Conditions reference keys. Reports can combine versions by key.
3. **Participation is separate from answers,** so anonymous surveys can block repeat responses without linking answers to people.
4. **Answers are normalized:** one row per answer, or one row per selected option for checkboxes. Every report becomes a simple `GROUP BY`.
5. **Department and location are snapshotted** onto each response at submit time, so later changes don't rewrite history.
6. **Trainings are surveys** with `kind = 'training'` (see `09-trainings.md`). Their extra data: a video per section, an answer key per question, attempts and scores per response, and which videos each person finished.

## Tables

### `app_users`
Who has elevated roles. Anyone not listed is an employee.

| Column | Type | Notes |
|---|---|---|
| employee_id | text PK | normalised (trim, uppercase) |
| name | text | |
| email | text | |
| role | text | `admin` \| `hr` |
| created_at | timestamptz | |

### `surveys`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text | mirrors draft title for listing |
| kind | text | `survey` \| `training`; set at creation, never changes (default `survey`) |
| status | text | `draft` \| `published` \| `closed` |
| draft | jsonb | full builder state (see shape below) |
| draft_updated_at | timestamptz | for autosave conflict checks |
| current_version_id | uuid FK → survey_versions | null until first publish |
| has_unpublished_changes | boolean | true when draft differs from current version |
| open_to_all | boolean | default false |
| created_by | text | employee_id |
| created_at / updated_at | timestamptz | |
| closed_at | timestamptz | |

### `survey_members`
| Column | Type | Notes |
|---|---|---|
| survey_id | uuid FK | PK part |
| employee_id | text | PK part |
| role | text | `owner` \| `coowner` \| `viewer` |

### `survey_versions`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| survey_id | uuid FK | |
| version_no | int | 1, 2, 3… unique per survey |
| title | text | |
| description | text | |
| settings | jsonb | layout, navigator, auto_next, one_response, allow_edit, anonymous, opens_at, closes_at; trainings also `quiz` and `due_date` |
| theme | jsonb | cover, background_style, background, background_color, blur, overlay, accent |
| published_by | text | |
| published_at | timestamptz | |

### `survey_sections`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| version_id | uuid FK | |
| key | uuid | stable across versions |
| sort_order | int | |
| title | text | |
| description | text | |
| condition | jsonb | null or `{src, op, val}` (src = question key) |
| video | jsonb | trainings only: null or the section's video (see Draft JSON shape) |

### `survey_questions`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| version_id | uuid FK | |
| section_id | uuid FK → survey_sections | |
| key | uuid | stable across versions |
| sort_order | int | global order within the version (Q1…Qn) |
| type | text | `single` \| `multi` \| `dropdown` \| `rating` \| `short` \| `long` \| `money` \| `number` |
| text | text | |
| help | text | |
| required | boolean | |
| config | jsonb | type settings, e.g. money `{currency, min, max, decimals}`, number `{number_min, number_max, number_decimals, number_unit}` |
| condition | jsonb | null or `{src, op, val}` |
| quiz | jsonb | trainings only: null (not marked) or the answer key `{points, correct_options}` / `{points, correct_min, correct_max}`. **Never sent to respondents** until the creator's rules allow |

### `question_options`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| question_id | uuid FK | |
| key | uuid | stable across versions (used in conditions) |
| sort_order | int | |
| label | text | |

### `survey_audience`
| Column | Type | Notes |
|---|---|---|
| survey_id | uuid FK | PK part |
| employee_id | text | PK part, normalised |
| name, email, department, location | text | optional, from upload |
| source | text | `upload` (v1), `rule` (later) |
| upload_id | uuid FK → audience_uploads | |
| added_at | timestamptz | |

### `audience_uploads`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| survey_id | uuid FK | |
| file_name | text | |
| mode | text | `append` \| `replace` |
| status | text | `preview` \| `applied` \| `discarded` |
| valid_count, duplicate_count, error_count | int | |
| rows | jsonb | parsed valid rows while in preview |
| errors | jsonb | `[{row, employee_id, problem}]` |
| uploaded_by | text | |
| uploaded_at | timestamptz | |

### `survey_participation`
One row per employee per survey. Enforces one response per person, even when anonymous.

| Column | Type | Notes |
|---|---|---|
| survey_id | uuid FK | PK part |
| employee_id | text | PK part |
| status | text | `in_progress` \| `submitted` |
| draft_answers | jsonb | autosaved answers before submit (keyed by question key) |
| draft_version_id | uuid | version the draft was started on |
| started_at, submitted_at, updated_at | timestamptz | |
| response_id | uuid | **null for anonymous surveys**; for trainings, the latest attempt |
| attempts | int | trainings: attempts submitted (default 0) |
| best_response_id | uuid FK → survey_responses | trainings: the attempt that counts |
| best_score | int | trainings: best score in %, null before the first attempt |
| passed | boolean | trainings: null before the first attempt or when there's no pass mark |
| passed_at | timestamptz | trainings: when they first passed |

### `survey_responses`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| survey_id | uuid FK | |
| version_id | uuid FK | |
| employee_id | text | **null when anonymous** |
| name | text | name the person signed in with, at submit. **Null when anonymous.** Reports prefer the audience list's name |
| department, location | text | snapshot at submit |
| submitted_at | timestamptz | for anonymous surveys, round to the hour |
| updated_at | timestamptz | |
| attempt_no | int | 1 for surveys; 1, 2, 3… per person for trainings. Unique with (survey_id, employee_id) when employee_id is set |
| points, max_points | int | trainings: points earned and available to this person (hidden questions excluded); null for surveys |
| score | int | trainings: points ÷ max_points as a whole % |
| passed | boolean | trainings: against the pass mark of this version; null when there's no pass mark |

### `response_answers`
| Column | Type | Notes |
|---|---|---|
| id | bigint identity PK | |
| response_id | uuid FK | |
| question_id | uuid FK | |
| option_id | uuid FK | null unless choice type; one row per selected option for `multi` |
| value_num | numeric(14,2) | rating, money and number |
| value_text | text | short and long |
| correct | boolean | trainings: whether this question was answered correctly (set on the question's first answer row); null when not marked. Makes "% correct per question" a simple count |

Rows exist only for **visible, answered** questions. "Shown" counts come from evaluating conditions on each response (see `07-reports-dashboard.md`), or from the optional `response_shown` table below.

### `response_shown` (recommended)
Written at submit time from the server's visibility evaluation. Makes "shown to N people" a simple count.

| Column | Type |
|---|---|
| response_id | uuid FK (PK part) |
| question_id | uuid FK (PK part) |

### `theme_assets`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| survey_id | uuid FK | null for gallery images |
| kind | text | `gallery` \| `upload` |
| name | text | |
| path | text | full-size WebP |
| mobile_path | text | ~800px wide WebP |
| width, height | int | |
| uploaded_by | text | |
| created_at | timestamptz | |

### `video_assets`
Uploaded training videos. Linked videos (internal server) need no row.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| survey_id | uuid FK | deleted with the survey |
| file_name | text | as uploaded, for display |
| path | text | under `FILE_STORAGE_PATH/videos/` |
| content_type | text | `video/mp4` \| `video/webm` (checked from the file's first bytes) |
| size_bytes | bigint | ≤ `VIDEO_MAX_MB` |
| duration_seconds | int | as read by the builder's browser; for display only |
| uploaded_by | text | |
| created_at | timestamptz | |

### `video_views`
Which section videos each person has finished, so they don't watch again and the server can enforce "questions after the video".

| Column | Type | Notes |
|---|---|---|
| survey_id | uuid FK | PK part |
| employee_id | text | PK part |
| section_key | uuid | PK part (stable across versions) |
| furthest_seconds | int | furthest point reached, for "no skipping ahead" and resuming |
| completed_at | timestamptz | null until the video ends |
| updated_at | timestamptz | |

### `audit_log`
| Column | Type |
|---|---|
| id | bigint identity PK |
| survey_id | uuid |
| actor | text |
| action | text (`publish`, `close`, `audience_upload`, `member_change`, …) |
| details | jsonb |
| at | timestamptz |

## Indexes

```sql
CREATE INDEX ON survey_responses (survey_id, submitted_at);
CREATE INDEX ON survey_responses (version_id);
CREATE INDEX ON survey_responses (survey_id, department);
CREATE INDEX ON response_answers (question_id, option_id);
CREATE INDEX ON response_answers (response_id);
CREATE INDEX ON survey_audience (survey_id, department);
CREATE INDEX ON survey_participation (employee_id, status);
CREATE INDEX ON survey_questions (version_id, sort_order);
CREATE INDEX ON surveys (kind, status);
CREATE INDEX ON response_answers (question_id, correct);
CREATE UNIQUE INDEX ON survey_responses (survey_id, employee_id, attempt_no) WHERE employee_id IS NOT NULL;
```

## Draft JSON shape (`surveys.draft`)

The builder sends and receives exactly this. Validate it with a Pydantic model on every save. (Comments below are explanations, not part of the JSON.)

```jsonc
{
  "title": "Workplace pulse, Q4 2026",
  "description": "Five quick questions…",
  "settings": {
    "layout": "step",              // "all" | "section" | "step"
    "show_navigator": true,
    "auto_next": false,
    "one_response": true,
    "allow_edit": false,
    "anonymous": false,
    "opens_at": "2026-11-10",
    "closes_at": "2026-11-24"
  },
  "theme": {
    "cover": "asset-uuid" ,         // or null = accent colour only
    "background_style": "image",    // "none" | "color" | "image"
    "background": "asset-uuid",
    "background_color": "#E8EEF3",
    "blur": true,
    "overlay": 25,                  // 0–60
    "accent": "#0E7A6A"
  },
  "sections": [
    { "key": "uuid", "title": "Your work setup", "description": "", "condition": null, "video": null }
  ],
  "questions": [
    {
      "key": "uuid",
      "section_key": "uuid",
      "type": "single",
      "text": "Which work mode do you follow most weeks?",
      "help": "",
      "required": true,
      "options": [ { "key": "uuid", "label": "Hybrid" } ],
      "config": {},
      "condition": null
    },
    {
      "key": "uuid",
      "section_key": "uuid",
      "type": "money",
      "text": "Roughly how much have you spent setting up your home workspace?",
      "required": false,
      "options": [],
      "config": { "currency": "INR", "min": null, "max": 500000, "decimals": false },
      "condition": { "src": "question-key", "op": "not", "val": "option-key" }
    }
  ]
}
```

`questions` is always stored in display order, grouped by section in section order.

### Training additions

A training's draft has the same shape plus these fields (`09-trainings.md`):

```jsonc
{
  "settings": {
    // …as above; "anonymous" and "allow_edit" are always false
    "due_date": "2026-11-16",                // or null
    "quiz": {
      "pass_mark": 80,                       // 1–100, or null = no pass mark
      "show_pass_mark": true,
      "show_score": true,
      "show_answers": "after_pass_or_last",  // "after_pass_or_last" | "always" | "never"
      "retakes": "limit",                    // "none" | "limit" | "until_pass" | "until_perfect"
      "max_attempts": 3                      // 2–10, used when retakes = "limit"
    }
  },
  "sections": [
    {
      "key": "uuid", "title": "Preventing fires", "description": "", "condition": null,
      "video": {
        "source": "upload",                  // "upload" | "link"
        "asset_id": "uuid",                  // when source = "upload" (video_assets.id)
        "url": null,                         // when source = "link": http(s) address of an MP4/WebM
        "allow_seek": false,
        "allow_speed": false
      }
    }
  ],
  "questions": [
    {
      "key": "uuid", "section_key": "uuid", "type": "single", "text": "What should you do first?",
      "options": [ { "key": "uuid-a", "label": "Raise the alarm" } ],
      "quiz": { "points": 1, "correct_options": ["uuid-a"] }   // or null = not marked
    },
    {
      "key": "uuid", "section_key": "uuid", "type": "number", "text": "How far away should you stand?",
      "quiz": { "points": 1, "correct_min": 2, "correct_max": 3 } // exact value: min = max
    }
  ]
}
```

## Answer storage by type

| Type | Stored as |
|---|---|
| single, dropdown | one row, `option_id` |
| multi | one row per selected option, `option_id` |
| rating | one row, `value_num` 1–5 |
| money | one row, `value_num` (2 decimals) |
| number | one row, `value_num` (whole, or 2 decimals) |
| short, long | one row, `value_text` (trimmed; max 2,000 / 10,000 chars) |
