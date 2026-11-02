import { useBuilderStore } from './store'

/** Editable survey title and description, with the accent-coloured top border. */
export function SurveyHeaderCard() {
  const title = useBuilderStore((s) => s.draft.title)
  const description = useBuilderStore((s) => s.draft.description)
  const setTitle = useBuilderStore((s) => s.setTitle)
  const setDescription = useBuilderStore((s) => s.setDescription)

  return (
    <section className="rounded-2xl border border-t-[6px] border-t-primary bg-card px-4 pt-4 pb-2.5 sm:px-5.5 sm:pt-5 sm:pb-3.5">
      <label className="sr-only" htmlFor="survey-title">
        Survey title
      </label>
      <input
        id="survey-title"
        data-survey-title
        className="w-full bg-transparent py-1 font-heading text-[23px] leading-tight font-semibold tracking-tight outline-none focus-visible:shadow-[0_2px_0_var(--primary)] sm:text-[28px]"
        placeholder="Untitled survey"
        maxLength={300}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value)
        }}
      />
      <label className="sr-only" htmlFor="survey-description">
        Description
      </label>
      <textarea
        id="survey-description"
        className="w-full resize-none bg-transparent py-1.5 text-muted-foreground outline-none focus-visible:shadow-[0_2px_0_var(--primary)]"
        rows={2}
        maxLength={2000}
        placeholder="Tell employees what this survey is about"
        value={description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
    </section>
  )
}
