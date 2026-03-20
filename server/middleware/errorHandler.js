export function errorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Filen är för stor.' });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Ogiltigt request-format.' });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Ett oväntat fel uppstod.'
  });
}
