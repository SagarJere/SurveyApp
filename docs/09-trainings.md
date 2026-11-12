# 09 — Trainings (video + quiz)

Agreed 2026-11-12. A **training** is a survey of kind `training`: employees watch one or more videos and answer questions about each, as a scored quiz with an optional pass mark and retakes. Trainings reuse the survey engine (builder, sections, questions, conditions, themes, audience, versions, the respondent form, results and exports); this doc covers only what's different.

Screen mockups (approved 2026-11-12): https://claude.ai/artifact/6v6JizVFUdLo65x1DVJWzM. They show the Trainings list, the builder (video sections, correct answers, Quiz tab), the employee flow on a phone (My trainings, watch, questions, passed, not passed with retake) and the results page with the completion report.

## Rules at a glance

| | Survey | Training |
|---|---|---|
| Created from | Surveys → New survey | Trainings → New training |
| Listed under (HR) | Surveys | Trainings |
| Listed under (employee) | My surveys | My trainings |
| Anonymous | optional | **never** (the setting is hidden and forced off) |
| Edit after submitting | optional | **never** (scores would change) |
| One response per employee | optional | replaced by **attempts** (below) |
| Video per section | no | **optional, one per section** |
| Correct answers, points, score | no | yes |
| Results | dashboard | dashboard + training figures + completion report |

The kind is chosen when the survey is created and can't be changed. Everything else about surveys (versions, publish, close, audience upload or open to all, themes, layouts, conditions) works the same.

## Video sections

- Each section can have **one video** at its top. A training can have any number of sections, so several videos are several sections.
- **Sources:**
  - **Upload** into Pulse: MP4 or WebM only, up to **200 MB** (`VIDEO_MAX_MB`, default 200). The server checks the file's real type from its first bytes, not the name, and stores it under `FILE_STORAGE_PATH/videos/`. No transcoding: HR converts other formats first.
  - **Internal link:** an `http(s)://` address of an MP4 or WebM file on the company's video server. It plays only for people who can reach that server (office network or VPN). Once Pulse is served over HTTPS, `http://` links are refused, because browsers block them.
- **Per-video options** (creator's choice, both off by default):
  - **Allow skipping ahead.** Off: the person can pause and rewind but can't move past the furthest point they've watched.
  - **Allow changing the playback speed.** Off: always 1×.
- **The rule:** the section's questions stay hidden until its video has played to the end ("The questions appear when the video ends"). In the one-question layout the video is its own step before the section's questions.
- **Remembered:** finishing a video is saved on the server, so leaving and coming back doesn't mean watching again. Watching again is always allowed.
- **Honest limit:** "watched" is reported by the browser. The server records and enforces it (questions of an unwatched video section can't be submitted), but it can't prove a person actually watched.
- **Preview:** HR gets a "Skip video" button in Preview.
- Uploaded videos are streamed with HTTP range requests (playback starts before the whole file downloads) through signed, expiring links, like theme images. They are deleted with their survey.

## Quiz and scoring

- **Marked questions:** single choice, dropdown, checkboxes and Number. HR ticks the correct option(s) (Number: an exact value or an accepted range) and sets **points** (default 1, whole numbers 1–100).
  - Checkboxes are correct only when exactly the right boxes are ticked (all right ones, no wrong ones). No part marks.
  - Rating, money, short and long questions aren't marked; they collect feedback. A question can also be left unmarked deliberately.
- **Hidden questions** (by a condition) don't count towards the total for that person.
- **Score** = points earned ÷ points available to that person, as a percentage rounded to a whole number. Calculated on the **server** at submit. The answer key never reaches the employee's browser before it may be shown.
- **Pass mark:** optional, 1–100%. Option: show it before they start (default on).
- **After submitting** (creator's choice):
  - Show the score and passed/not passed (default on).
  - Show the correct answers: **once they pass or have no attempts left** (default), always after each attempt, or never.
- **Retakes** (creator's choice):
  - No retakes (one attempt).
  - Up to N attempts in total (2–10).
  - Until they pass (needs a pass mark).
  - Until every answer is correct (100%).
- A retake skips the videos: the person only answers the questions again (watching again is optional).
- **The best attempt counts** for the person's result, the reports and the completion report. Every attempt is kept.
- **Due date:** optional. Shown on My trainings ("Due in 4 days", "Overdue"). People can still complete after it; reports mark those as late.

## Employee experience

- **My trainings** (`/trainings`): To do (with due dates), In progress (videos watched so far), Completed (Passed · score, or Not passed with "Retake" while attempts remain).
- Taking a training: cover, then per section: video → questions → next section. The pass mark is shown at the start when the creator allows.
- **Score screen:** a score ring, "You passed" / "Not passed yet", points, the pass mark, attempt N of M, attempts left, the answer review when allowed, and "Retake now" / "Go to My trainings".

## Reports

- **Trainings home** (`/admin/trainings`): KPIs (live trainings, completed this week, average pass rate) and per training: completion ring, pass rate, due date, Share / Results / Edit.
- **Results page** for a training adds, above the usual question widgets:
  - Tiles: completed (of invited), passed (% of completed), average score (best attempts), average attempts.
  - **% correct per question**, lowest first, with "Needs attention" under 60%.
  - Attempts needed to pass, and how many people watched each video to the end.
  - **Completion report:** everyone in the audience with department, location, status (Passed, Not passed, In progress, Not started), best score, attempts used, completed date, late flag. Filter by status; download as Excel.
- Question widgets and the Responses export use **each person's best attempt only**, so nobody is counted twice. "Responses with analytics" adds a Completion sheet.

## Build steps

See `08-implementation-plan.md` → Phase T. Three steps, each tested and tagged: T1 trainings area and video sections, T2 quiz, scoring and retakes, T3 training results and completion report.
