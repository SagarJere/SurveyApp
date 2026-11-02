# Shared test cases

Rules that exist in both the backend (Python) and the frontend (TypeScript) are tested against the same files here, so the two implementations can't drift apart.

| File | Python test | TypeScript test |
|---|---|---|
| `test-cases/money.json` | `backend/app/tests/test_money.py` | `frontend/src/features/survey-logic/money.test.ts` |
| `test-cases/survey-logic.json` | `backend/app/tests/test_survey_logic.py` | `frontend/src/features/survey-logic/survey-logic.test.ts` |

When a rule changes, change the case file first, then make both sides pass.
| `test-cases/workplace-pulse.json` | API tests (`test_surveys.py`) | builder tests |
