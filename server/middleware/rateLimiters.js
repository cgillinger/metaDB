/**
 * Shared rate limiter instances used across the application.
 *
 * apiLimiter    — applied globally on /api/* in server/index.js (200 req/min)
 * uploadLimiter — applied per-route on file upload POST endpoints (10 req/min)
 * backupLimiter — applied on the backup endpoint (2 req/min); no admin token required
 */
import rateLimit from 'express-rate-limit';

// General API rate limiter — broad protection against abuse
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,  // Return rate-limit info in RateLimit-* headers
  legacyHeaders: false,   // Disable X-RateLimit-* headers
  message: { error: 'För många förfrågningar. Försök igen om en minut.' },
});

// Upload-specific rate limiter — stricter limit for file import endpoints
export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'För många uppladdningar. Försök igen om en minut.' },
});

// Backup-specific rate limiter — very low limit to prevent DB exfiltration
export const backupLimiter = rateLimit({
  windowMs: 60_000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'För många backup-förfrågningar. Försök igen om en minut.' },
});
