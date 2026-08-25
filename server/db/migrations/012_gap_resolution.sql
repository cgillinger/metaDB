-- Migration 012: account_gaps.resolution — distinguishes HOW a gap was
-- closed. 'imported' means the auto-resolve path saw actual posts for that
-- (account, month) in a later import (see autoResolveGaps in accountRoster.js).
-- 'no_posts' means a person manually dismissed the gap because the account
-- genuinely published nothing that month — see dismissGapMonth. NULL means
-- still open. Kept separate from resolved_at (a timestamp, not a reason) so
-- a dismissed row can be told apart from a naturally-closed one, e.g. to
-- protect 'imported' rows from being reopened by mistake (reopenGapMonth).

ALTER TABLE account_gaps ADD COLUMN resolution TEXT;

UPDATE account_gaps SET resolution = 'imported' WHERE resolved_at IS NOT NULL;
