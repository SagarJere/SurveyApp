import { CheckIcon, CopyIcon, MailIcon } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { mailtoHref, surveyLink } from './share'
import { UNTITLED_SURVEY } from './types'

interface ShareSurveyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  surveyId: string
  title: string
  opensAt: string | null
  closesAt: string | null
  /** Who can open the link: the uploaded list, or every employee. */
  openToAll: boolean
  /** Shown above the link, e.g. "Published. Share the link with your audience." */
  intro?: string
}

/** The survey link, ready to copy or send by email. */
export function ShareSurveyDialog({
  open,
  onOpenChange,
  surveyId,
  title,
  opensAt,
  closesAt,
  openToAll,
  intro,
}: ShareSurveyDialogProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  const name = title.trim() || UNTITLED_SURVEY
  const link = surveyLink(surveyId)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Survey link copied.')
      window.setTimeout(() => {
        setCopied(false)
      }, 2000)
    } catch {
      // Clipboard blocked (e.g. an http page or browser setting): select it for a manual copy.
      input.current?.select()
      toast.info("Couldn't copy automatically. The link is selected: press Ctrl+C (⌘C on a Mac).")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setCopied(false)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Share “{name}”</DialogTitle>
        <DialogDescription>
          {intro ? `${intro} ` : ''}
          {openToAll
            ? 'Every employee can open this link.'
            : 'Only people on the audience list can open this link. Anyone else sees a message that it isn’t available to them.'}
        </DialogDescription>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-link`}>Survey link</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={input}
              id={`${id}-link`}
              readOnly
              value={link}
              className="font-mono text-sm"
              onFocus={(event) => {
                event.currentTarget.select()
              }}
            />
            <Button
              className="shrink-0"
              onClick={() => {
                void copy()
              }}
            >
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Opens your email app with a ready-made message.
          </p>
          <Button variant="outline" asChild>
            <a href={mailtoHref({ title: name, link, opensAt, closesAt })}>
              <MailIcon aria-hidden="true" />
              Email
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
