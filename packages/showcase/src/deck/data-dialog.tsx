import type { Slide } from './slides'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'

type DataDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  slide: Slide
}

/** The table-view twin of the current slide: every figure it draws, as text. */
export function DataDialog({ open, onOpenChange, slide }: DataDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent className="w-[760px]">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          Figures on this slide
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {slide.name}. Every number the slide draws, as a table.
        </DialogDescription>
        {slide.figures.length > 0 ? (
          <table className="mt-5 w-full border-collapse text-left">
            <thead>
              <tr className="system-xs-medium-uppercase text-text-tertiary">
                <th scope="col" className="border-b border-divider-regular py-2 pr-4 font-medium">
                  Figure
                </th>
                <th
                  scope="col"
                  className="border-b border-divider-regular py-2 pr-4 text-right font-medium"
                >
                  Value
                </th>
                <th scope="col" className="border-b border-divider-regular py-2 font-medium">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {slide.figures.map((figure) => (
                <tr key={figure.label} className="system-sm-regular">
                  <td className="border-b border-divider-subtle py-2.5 pr-4 text-text-secondary">
                    {figure.label}
                  </td>
                  <td className="border-b border-divider-subtle py-2.5 pr-4 text-right font-semibold text-text-primary tabular-nums">
                    {figure.value}
                  </td>
                  <td className="border-b border-divider-subtle py-2.5 text-text-tertiary">
                    {figure.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-5 system-sm-regular text-text-tertiary">
            This slide carries no figures.
          </p>
        )}
        <div className="mt-6 flex justify-end">
          <DialogClose render={<Button variant="secondary" size="medium" />}>Close</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
