/**
 * The builder's in-progress draft plus UI state (docs/05-survey-builder.md, "Builder state").
 * Every draft change bumps `revision`; autosave watches it.
 */
import { create } from 'zustand'

import type { Issue } from '@/features/survey-logic/validation'
import type { Condition, Draft, MoneyConfig, QuestionType } from '@/features/survey-logic/types'

import * as ops from './draft-ops'

interface BuilderState {
  surveyId: string | null
  /** Identifies one load of a survey (its draft_updated_at), so a reload re-initialises. */
  loadToken: string | null
  draft: Draft
  revision: number
  /** The one expanded question card. */
  openKey: string | null
  collapsed: ReadonlySet<string>
  /** Section whose type picker is open. */
  addingIn: string | null
  /** Item showing "no question above can be a source" after Add condition. */
  conditionPrompt: string | null
  /** CSS selector to focus after the next render (new question, moved card, …). */
  focusRequest: string | null
  /** Issues from the last "Check for issues", or null if not checked since the last edit. */
  issues: Issue[] | null

  load: (surveyId: string, draft: Draft, loadToken: string) => void
  requestFocus: (selector: string | null) => void
  setOpen: (key: string | null) => void
  toggleCollapsed: (sectionKey: string) => void
  setAddingIn: (sectionKey: string | null) => void
  setIssues: (issues: Issue[] | null) => void

  setTitle: (title: string) => void
  setDescription: (description: string) => void
  addQuestion: (type: QuestionType, sectionKey: string) => void
  updateQuestion: (key: string, patch: ops.QuestionPatch) => void
  changeType: (key: string, type: QuestionType) => void
  updateMoneyConfig: (key: string, patch: Partial<MoneyConfig>) => void
  addOption: (key: string) => void
  updateOption: (key: string, optionKey: string, label: string) => void
  removeOption: (key: string, optionKey: string) => void
  moveQuestion: (key: string, direction: -1 | 1) => void
  duplicateQuestion: (key: string) => void
  deleteQuestion: (key: string) => ops.DeletedQuestion | null
  restoreQuestion: (deleted: ops.DeletedQuestion) => void
  addSection: () => void
  updateSection: (key: string, patch: ops.SectionPatch) => void
  moveSection: (key: string, direction: -1 | 1) => void
  deleteSection: (key: string) => (ops.DeletedSection & { before: Draft }) | null
  restoreDraft: (draft: Draft) => void
  addCondition: (target: ops.ConditionTarget) => void
  setCondition: (target: ops.ConditionTarget, condition: Condition | null) => void
  closeConditionPrompt: () => void
}

const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  settings: {
    layout: 'step',
    show_navigator: true,
    auto_next: false,
    one_response: true,
    allow_edit: false,
    anonymous: false,
    opens_at: null,
    closes_at: null,
  },
  theme: {
    cover: null,
    background_style: 'none',
    background: null,
    background_color: '#E8EEF3',
    blur: true,
    overlay: 25,
    accent: '#0E7A6A',
  },
  sections: [],
  questions: [],
}

export const useBuilderStore = create<BuilderState>()((set, get) => {
  /** Apply a draft change; skip the revision bump when nothing changed. */
  const edit = (next: Draft, ui: Partial<BuilderState> = {}) => {
    const { draft, revision } = get()
    if (next === draft) {
      if (Object.keys(ui).length) set(ui)
      return
    }
    set({ draft: next, revision: revision + 1, issues: null, ...ui })
  }

  return {
    surveyId: null,
    loadToken: null,
    draft: EMPTY_DRAFT,
    revision: 0,
    openKey: null,
    collapsed: new Set(),
    addingIn: null,
    conditionPrompt: null,
    focusRequest: null,
    issues: null,

    load: (surveyId, draft, loadToken) => {
      set({
        surveyId,
        loadToken,
        draft,
        revision: 0,
        openKey: null,
        collapsed: new Set(),
        addingIn: null,
        conditionPrompt: null,
        focusRequest: null,
        issues: null,
      })
    },
    requestFocus: (selector) => {
      set({ focusRequest: selector })
    },
    setOpen: (key) => {
      set({ openKey: key, conditionPrompt: null })
    },
    toggleCollapsed: (sectionKey) => {
      const collapsed = new Set(get().collapsed)
      if (collapsed.has(sectionKey)) collapsed.delete(sectionKey)
      else collapsed.add(sectionKey)
      set({ collapsed })
    },
    setAddingIn: (sectionKey) => {
      set({ addingIn: sectionKey })
    },
    setIssues: (issues) => {
      set({ issues })
    },

    setTitle: (title) => {
      edit(ops.setTitle(get().draft, title))
    },
    setDescription: (description) => {
      edit(ops.setDescription(get().draft, description))
    },
    addQuestion: (type, sectionKey) => {
      const [draft, question] = ops.addQuestion(get().draft, type, sectionKey)
      const collapsed = new Set(get().collapsed)
      collapsed.delete(sectionKey)
      edit(draft, {
        openKey: question.key,
        addingIn: null,
        collapsed,
        focusRequest: `[data-question-text="${question.key}"]`,
      })
    },
    updateQuestion: (key, patch) => {
      edit(ops.updateQuestion(get().draft, key, patch))
    },
    changeType: (key, type) => {
      edit(ops.changeType(get().draft, key, type))
    },
    updateMoneyConfig: (key, patch) => {
      edit(ops.updateMoneyConfig(get().draft, key, patch))
    },
    addOption: (key) => {
      const [draft, option] = ops.addOption(get().draft, key)
      edit(draft, { focusRequest: `[data-option="${option.key}"]` })
    },
    updateOption: (key, optionKey, label) => {
      edit(ops.updateOption(get().draft, key, optionKey, label))
    },
    removeOption: (key, optionKey) => {
      edit(ops.removeOption(get().draft, key, optionKey))
    },
    moveQuestion: (key, direction) => {
      edit(ops.moveQuestion(get().draft, key, direction), {
        focusRequest: `[data-move="${direction < 0 ? 'up' : 'down'}:${key}"]`,
      })
    },
    duplicateQuestion: (key) => {
      const [draft, copy] = ops.duplicateQuestion(get().draft, key)
      if (!copy) return
      edit(draft, { openKey: copy.key, focusRequest: `[data-question-text="${copy.key}"]` })
    },
    deleteQuestion: (key) => {
      const [draft, deleted] = ops.deleteQuestion(get().draft, key)
      edit(draft, get().openKey === key ? { openKey: null } : {})
      return deleted
    },
    restoreQuestion: (deleted) => {
      edit(ops.restoreQuestion(get().draft, deleted), {
        openKey: deleted.question.key,
        focusRequest: `[data-question-head="${deleted.question.key}"]`,
      })
    },
    addSection: () => {
      const [draft, section] = ops.addSection(get().draft)
      edit(draft, { addingIn: null, focusRequest: `[data-section-title="${section.key}"]` })
    },
    updateSection: (key, patch) => {
      edit(ops.updateSection(get().draft, key, patch))
    },
    moveSection: (key, direction) => {
      edit(ops.moveSection(get().draft, key, direction), {
        focusRequest: `[data-section-move="${direction < 0 ? 'up' : 'down'}:${key}"]`,
      })
    },
    deleteSection: (key) => {
      const before = get().draft
      const [draft, deleted] = ops.deleteSection(before, key)
      if (!deleted) return null
      edit(draft)
      return { ...deleted, before }
    },
    restoreDraft: (draft) => {
      edit(draft)
    },
    addCondition: (target) => {
      const condition = ops.defaultCondition(
        get().draft,
        target.kind === 'question' ? { question: target.key } : { section: target.key },
      )
      if (!condition) {
        set({ conditionPrompt: target.key })
        return
      }
      edit(ops.setCondition(get().draft, target, condition), { conditionPrompt: null })
    },
    setCondition: (target, condition) => {
      edit(ops.setCondition(get().draft, target, condition))
    },
    closeConditionPrompt: () => {
      set({ conditionPrompt: null })
    },
  }
})
