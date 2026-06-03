/**
 * Admin-token middleware for maintenance endpoints.
 *
 * When ADMIN_TOKEN is set in the environment every request to a protected
 * route must supply the matching value in the X-Admin-Token header.
 * When ADMIN_TOKEN is not set (dev / default Docker deployment) all requests
 * are allowed through — existing behaviour is fully preserved.
 */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

export function requireAdmin(req, res, next) {
  // No token configured → open access (dev mode or unset in docker-compose)
  if (!ADMIN_TOKEN) return next();

  const provided = req.headers['x-admin-token'];
  if (provided === ADMIN_TOKEN) return next();

  res.status(403).json({ error: 'Åtkomst nekad.' });
}
