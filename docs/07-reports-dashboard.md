# 07 — Reports and dashboards

## Three levels

1. **Surveys home** (`/admin/surveys`): every survey the user can see. Each item shows title, status pill, version, response-rate ring (responded / audience), "Closes in N days" warning, and actions (Edit, Results, Duplicate, Close). KPIs on top: live surveys, responses this week, average response rate. Filter by status and a search box.
2. **Survey results** (`/admin/surveys/:id/results`): the main dashboard (below).
3. **Individual responses**: a tab on the results page, **only for non-anonymous surveys**. A table of responses; clicking one opens the full submission.

## Results dashboard layout

**Header**
- Survey title, version selector ("All versions" when questions are compatible; otherwise per version).
- A one-line takeaway built from data: "412 people have responded, 86% of those invited. Average satisfaction with their work setup is 3.5 out of 5."
- **Filters:** Department, Location, date range. Filter state lives in the URL. A "Clear filters" button appears when any are set.

**Headline tiles** (4)
- Responses ("of 480 invited")
- Response rate
- Headline score: average of the first rating question (configurable later)
- For surveys with a Money question: median amount with the amount in words

**Responses per day**: bar chart, one bar per day, with a dashed marker for reminder emails (when reminders exist). Tooltip: date + count.

**Participation by department**: table with Department, Invited, Responded, Rate (with in-cell bar; under 60% in the danger colour). Clicking a row sets the Department filter for the whole page. "Download non-responders" button (owner/co-owner only).

**Question widgets**, grouped under section headings in survey order. Each card shows the question number and text, a note with who saw it, and a type-specific widget:

| Type | Widget |
|---|---|
| Single choice / Dropdown | horizontal bars: label, bar, "42% · 60". Ordered as in the survey |
| Checkboxes | same bars, % of people shown the question. Note: "They could pick more than one, so shares add up to more than 100%." |
| Rating | average (large) + distribution bars for 1–5 |
| Money | stat boxes: Total, Average (+ words), Median (+ words), Lowest, Highest; then range bars (Under ₹10,000 / ₹10,000–25,000 / ₹25,000–50,000 / ₹50,000–1,00,000 / ₹1,00,000 and above) |
| Short / Paragraph | "N of M people left a comment", search box, scrollable list with department (never names for anonymous surveys). Later: keyword frequency |

## The denominator rule

Percentages are out of **the people who were shown the question**, not all respondents. Every card says it: "Only shown to people who work remotely: 94 people."

- `shown` = responses where the question was visible (from `response_shown`).
- `answered` = responses with at least one answer row for that question.
- Choice share = option count ÷ shown.

## Anonymity and small groups

- **Minimum group size: 5, for anonymous surveys only.** Named surveys already show who answered, so they show every answer however few there are (agreed 2026-11-09). For an anonymous survey, if the current filters leave fewer than 5 responses, show only participation figures (responses, invited, rate). Hide all answer widgets, comments and averages, and show a notice: "Fewer than 5 people in this group have responded, so their answers are hidden to protect anonymity."
- Apply the rule on the **server** (`small_group: true`, no answer data in the payload), not just in the UI.
- Anonymous surveys: no individual responses tab, no names anywhere, `submitted_at` rounded to the hour.
- Department-scoped viewers (later phase) get the same rule.

## SQL patterns

```sql
-- choice counts for one question, with filters
SELECT o.key AS option_key, o.label, COUNT(a.id) AS n
FROM question_options o
LEFT JOIN response_answers a ON a.option_id = o.id
LEFT JOIN survey_responses r ON r.id = a.response_id
  AND (:department IS NULL OR r.department = :department)
WHERE o.question_id = :question_id
GROUP BY o.key, o.label, o.sort_order
ORDER BY o.sort_order;

-- shown / answered
SELECT COUNT(*) AS shown FROM response_shown s
JOIN survey_responses r ON r.id = s.response_id
WHERE s.question_id = :question_id AND (:department IS NULL OR r.department = :department);

-- money stats
SELECT COUNT(*) n, SUM(value_num) total, AVG(value_num) avg,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY value_num) median,
       MIN(value_num) min, MAX(value_num) max
FROM response_answers a JOIN survey_responses r ON r.id = a.response_id
WHERE a.question_id = :question_id AND (:department IS NULL OR r.department = :department);

-- responses per day (fill gaps)
SELECT d::date AS day, COUNT(r.id) AS n
FROM generate_series(:start, :end, interval '1 day') d
LEFT JOIN survey_responses r ON r.submitted_at::date = d::date AND r.survey_id = :survey_id
GROUP BY d ORDER BY d;
```

When reporting across versions, join on question `key` and option `key` instead of ids.

## Results API payload (`/results/questions`)

```jsonc
{
  "small_group": false,
  "sections": [
    {
      "key": "…", "title": "Your work setup",
      "questions": [
        { "key": "…", "number": 2, "type": "single", "text": "Which work mode…",
          "shown": 410, "answered": 410,
          "options": [ { "key": "…", "label": "Hybrid", "n": 213, "share": 0.52 } ] },
        { "key": "…", "number": 5, "type": "money", "currency": "INR", "shown": 300, "answered": 230,
          "stats": { "total": 8097000, "average": 35204, "median": 25750, "min": 2000, "max": 222500,
                     "average_words": "Thirty-five thousand two hundred four rupees only",
                     "median_words": "Twenty-five thousand seven hundred fifty rupees only" },
          "ranges": [ { "label": "Under ₹10,000", "n": 34, "share": 0.148 } ] },
        { "key": "…", "number": 1, "type": "rating", "shown": 410, "answered": 410, "average": 3.5,
          "distribution": [ { "value": 1, "n": 8, "share": 0.02 } ] }
      ]
    }
  ]
}
```

Generate amount words on the server so exports and dashboard match.

## Exports

**Excel (`export.xlsx?kind=responses|analytics`)**. The results page has a Download menu with both.

Every sheet opens with a title block: the survey title (row 1), the response count with invited and rate (row 2), and the export time with filters (row 3). Row 4 is blank and the headings start on row 5. The data is an Excel table, so filter buttons and pivot tables work. The survey title is also the print header, with page numbers in the footer.

- *Responses* (`kind=responses`): the Responses sheet below, on its own.
- *Responses with analytics* (`kind=analytics`, the default): Summary with a native Excel bar chart per choice, rating and money question; Participation by department with a chart; Responses per day with a chart; Responses; Comments.

- *Summary* sheet: the same figures as the dashboard, one block per question.
- *Responses* sheet: one row per response. Columns: Response ID, Submitted at, Department, Location, then one column per question ("Q2. Which work mode…"). Checkboxes are joined with "; ". Money gets two columns: amount (numeric, formatted ₹ #,##,##0) and "Q5 in words". For non-anonymous surveys, add Employee ID and Name after Response ID.
- *Comments* sheet.
- Respect current filters and the small-group rule.

**Later:** PDF snapshot of the dashboard, scheduled weekly email to owners, compare view (two departments side by side), cross-tab (one question by another), keyword frequency for comments, section scores (average of rating questions per section).

## Frontend notes

- Recharts for the daily bar chart. Simple HTML/CSS bars for option lists (easier to make responsive and accessible).
- Each widget comes from the question type registry's `ReportWidget`.
- Skeleton placeholders while loading. Cards keep their height so the layout doesn't jump.
- A sample of this dashboard was previewed during design: headline sentence + 4 tiles, responses per day with reminder line, clickable participation table, question cards by section, money stats with words and ranges, searchable comments, small-group notice.
