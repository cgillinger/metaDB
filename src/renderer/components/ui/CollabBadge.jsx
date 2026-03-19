import React from 'react';
import { Users } from 'lucide-react';

const CollabBadge = ({ compact = false }) => {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-300">
        <Users className="h-3 w-3" />
        Samarbete?
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-300"
      title="Misstänkt samarbetsinlägg – kontot är inte ditt, men inlägget syns i din export eftersom Meta inkluderar collab-publiceringar automatiskt"
    >
      <Users className="h-3 w-3" />
      Misstänkt samarbete
    </span>
  );
};

export default CollabBadge;
