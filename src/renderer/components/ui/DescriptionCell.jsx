/**
 * DescriptionCell — visar truncerad beskrivning som klickbar yta;
 * klick öppnar Dialog med full text. Stöder mycket långa beskrivningar
 * (1500+ tecken) som inte får plats inline.
 */
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Button } from './button';

const DescriptionCell = ({ description, lines = 2, className = '' }) => {
  const [open, setOpen] = useState(false);
  if (!description) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`text-left hover:bg-muted/50 rounded px-1 -mx-1 transition-colors cursor-pointer ${className}`}
        style={{
          display: '-webkit-box',
          WebkitLineClamp: lines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title="Klicka för att se hela texten"
      >
        {description}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Beskrivning</DialogTitle>
          </DialogHeader>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {description}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Stäng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DescriptionCell;
