/**
 * Client-side entry for the unified column config.
 *
 * The canonical implementation lives in shared/columnConfig.js (used by both
 * server and client). This module is a pure re-export so the two sides can
 * never drift apart — add or change exports in shared/columnConfig.js only.
 */
export * from '../../shared/columnConfig.js';
