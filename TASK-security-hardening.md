# TASK: Säkerhetshärdning av Meta Analytics

> **Modell:** Sonnet räcker.
> **Repo:** metaDB
> **Krav:** Ingen funktionalitet, stabilitet eller robusthet får gå förlorad. Alla befintliga API-kontrakt ska vara intakta. Appen ska fungera identiskt för slutanvändaren efter härdningen.

---

## Bakgrund

Meta Analytics är en Express + React + SQLite-app som kör i Docker på en Ubuntu-server, åtkomlig via LAN/Tailscale. En säkerhetsgenomgång har identifierat 13 svagheter. Denna task implementerar åtgärderna i 5 faser.

---

## Fas 1 — Express-grundskydd (låg risk, snabba vinster)

### 1a. Begränsa JSON body size
I `server/index.js`, ändra:
```js
app.use(express.json());
```
till:
```js
app.use(express.json({ limit: '1mb' }));
```

### 1b. Installera och konfigurera helmet
```bash
npm install helmet
```
I `server/index.js`, lägg till efter `app.use(express.json(...))`:
```js
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    }
  }
}));
```

### 1c. Installera och konfigurera rate limiting
```bash
npm install express-rate-limit
```
I `server/index.js`, lägg till två limiters:
```js
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'För många förfrågningar. Försök igen om en minut.' }
});

const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'För många uppladdningar. Försök igen om en minut.' }
});

app.use('/api/', apiLimiter);
```
Applicera `uploadLimiter` specifikt på upload-endpoints: lägg till som middleware på POST-routerna i `imports.js`, `reach.js` och `gaListens.js`.

### 1d. Prod-felhantering utan interna detaljer
I `server/middleware/errorHandler.js`, ändra:
```js
res.status(err.status || 500).json({
  error: err.message || 'Ett oväntat fel uppstod.'
});
```
till:
```js
const isDev = process.env.NODE_ENV !== 'production';
res.status(err.status || 500).json({
  error: isDev ? err.message : 'Ett oväntat fel uppstod.'
});
```

### Verifiering fas 1
- `npm run dev` startar utan fel
- Responser innehåller `X-Content-Type-Options`, `X-Frame-Options` etc. (inspektera med `curl -I`)
- Body > 1MB ger 413
- 201+ snabba requests ger 429

---

## Fas 2 — Input-validering och SQL-härdning

### 2a. Metric/sort whitelist-map i trends.js
Ersätt den dynamiska `SUM(${metric})`-konstruktionen med en explicit map:
```js
const METRIC_SQL_MAP = {
  views: 'SUM(views)',
  reach: 'CAST(ROUND(AVG(reach)) AS INTEGER)',
  average_reach: 'CAST(ROUND(AVG(reach)) AS INTEGER)',
  likes: 'SUM(likes)',
  comments: 'SUM(comments)',
  shares: 'SUM(shares)',
  total_clicks: 'SUM(total_clicks)',
  link_clicks: 'SUM(link_clicks)',
  other_clicks: 'SUM(other_clicks)',
  saves: 'SUM(saves)',
  follows: 'SUM(follows)',
  interactions: 'SUM(interactions)',
  engagement: 'SUM(engagement)',
  post_count: 'COUNT(*)',
  posts_per_day: 'COUNT(*)',
};
```
Använd sedan:
```js
const valueExpr = METRIC_SQL_MAP[metric];
if (!valueExpr) return res.status(400).json({ error: 'Ogiltigt mätvärde.' });
```

Gör samma sak för sort-kolumner i `accounts.js`, `posts.js`, `postTypes.js` — skapa en `SORT_SQL_MAP` som mappar tillåtna sort-nycklar till faktiska kolumnnamn. Exempel:
```js
const SORT_SQL_MAP = {
  views: 'views',
  reach: 'reach',
  account_name: 'account_name',
  post_count: 'post_count',
  // ...alla andra tillåtna
};
const sortColumn = SORT_SQL_MAP[req.query.sort] || 'views';
```
**Viktigt:** Se till att alla befintliga sort-alternativ fortfarande fungerar.

### 2b. Månadsformat-validering på DELETE-endpoints
I `server/routes/reach.js` (`DELETE /:month`) och `server/routes/gaListens.js` (`DELETE /:month`), lägg till i början av handlern:
```js
if (!/^\d{4}-\d{2}$/.test(req.params.month)) {
  return res.status(400).json({ error: 'Ogiltigt månadsformat. Förväntat: YYYY-MM.' });
}
```

### 2c. Multer filstorleksbegränsning och filtypsfilter
I **alla tre filer** som skapar multer-instanser (`server/routes/imports.js`, `server/routes/reach.js`, `server/routes/gaListens.js`), ändra:
```js
const upload = multer({ dest: '/tmp/meta-uploads/' });
```
till:
```js
const upload = multer({
  dest: '/tmp/meta-uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Endast CSV-filer tillåtna.'));
    }
  }
});
```

### 2d. Enkel textsanering vid CSV-import
I `server/services/csvProcessor.js`, lägg till en hjälpfunktion:
```js
function sanitizeText(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>]/g, '');
}
```
Applicera den på `description`, `account_name` och `account_username` i post-objektet som byggs i slutet av for-loopen:
```js
posts.push({
  // ...
  account_name: sanitizeText(mapped.account_name || null),
  account_username: sanitizeText(mapped.account_username || null),
  description: sanitizeText(mapped.description || null),
  // ...
});
```

### Verifiering fas 2
- Import av en giltig CSV fungerar som förut
- Ladda upp en `.txt`-fil → avvisas
- Ladda upp en > 50MB fil → 413
- `DELETE /api/reach/not-a-month` → 400
- Trend-API med `metric=views` fungerar som förut
- Sortering i alla vyer fungerar som förut

---

## Fas 3 — Autentisering för underhållsendpoints

### 3a. Admin-token middleware
Skapa `server/middleware/adminAuth.js`:
```js
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

export function requireAdmin(req, res, next) {
  // Om inget token är konfigurerat, tillåt (dev-mode)
  if (!ADMIN_TOKEN) return next();
  
  const provided = req.headers['x-admin-token'];
  if (provided === ADMIN_TOKEN) return next();
  
  res.status(403).json({ error: 'Åtkomst nekad.' });
}
```

### 3b. Applicera på maintenance-routes
I `server/index.js`:
```js
import { requireAdmin } from './middleware/adminAuth.js';
app.use('/api/maintenance', requireAdmin, maintenanceRouter);
```

### 3c. Uppdatera frontend för backup
I `src/utils/apiClient.js`, uppdatera `getBackupUrl` och lägg till en metod som skickar token:
```js
getBackupUrl: () => '/api/maintenance/backup',
// Lägg till en ny metod för autentiserade maintenance-anrop:
getStatsAuthed: () => fetch('/api/maintenance/stats', {
  headers: { 'X-Admin-Token': window.__ADMIN_TOKEN || '' }
}).then(handleResponse),
```
**OBS:** Eftersom appen bara är tillgänglig via LAN/Tailscale och tokenet är valfritt (dev utan token = öppet), behöver vi inte bygga ett inloggningsformulär. Dokumentera bara i README att `ADMIN_TOKEN` kan sättas som env-variabel i `docker-compose.yml`:
```yaml
environment:
  - ADMIN_TOKEN=mitt-hemliga-token
```

### 3d. Uppdatera frontend för att skicka token via header
I `ImportManager.jsx`, ändra backup-länken från en vanlig `<a href>` till en fetch + blob-download som skickar headern. Alternativt: håll det enkelt och låt backup-endpointen vara öppen men logga åtkomst. **Enklast:** Flytta enbart `vacuum`, `redetect-collab` och `stats` bakom admin-token, men låt `backup` vara öppen bakom rate limiting (max 2/min).

Skapa en dedikerad rate limiter för backup:
```js
const backupLimiter = rateLimit({ windowMs: 60_000, max: 2 });
```
Applicera den i maintenance-routern.

### Verifiering fas 3
- Utan `ADMIN_TOKEN` i env: allt fungerar som förut
- Med `ADMIN_TOKEN=test123`: `curl /api/maintenance/stats` → 403, `curl -H "X-Admin-Token: test123" /api/maintenance/stats` → 200
- Backup-download fungerar med rate limit

---

## Fas 4 — Docker-härdning

### 4a. Non-root user i Dockerfile
Lägg till före `CMD`:
```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app /data
USER appuser
```

### 4b. Tmp-cleanup vid serverstart
I `server/index.js`, efter `getDb()`:
```js
// Rensa eventuella kvarvarande temp-filer från tidigare körningar
import { readdirSync, unlinkSync, existsSync } from 'fs';
const TMP_UPLOAD_DIR = '/tmp/meta-uploads/';
if (existsSync(TMP_UPLOAD_DIR)) {
  for (const f of readdirSync(TMP_UPLOAD_DIR)) {
    try { unlinkSync(path.join(TMP_UPLOAD_DIR, f)); } catch {}
  }
}
```

### 4c. SQLite busy_timeout
I `server/db/connection.js`, efter WAL-pragmat:
```js
db.pragma('busy_timeout = 5000');
```

### Verifiering fas 4
- `docker compose up --build` startar utan fel
- I containern: `whoami` → appuser (ej root)
- Appen fungerar identiskt

---

## Fas 5 — Dokumentation

### 5a. Uppdatera README.md
Lägg till ett avsnitt "Säkerhet" som beskriver:
- Att appen är avsedd för LAN/Tailscale, inte publikt internet
- Att `ADMIN_TOKEN` kan sättas i docker-compose.yml för att skydda underhållsendpoints
- Att rate limiting är aktiverat
- Att containern kör som non-root
- Att helmet-headers är konfigurerade

### 5b. Uppdatera docker-compose.yml med kommenterad ADMIN_TOKEN
```yaml
environment:
  - NODE_ENV=production
  - DB_PATH=/data/analytics.db
  - HOST=0.0.0.0
  - PORT=3001
  # - ADMIN_TOKEN=byt-till-ditt-eget-token
```

### Verifiering fas 5
- README har säkerhetsavsnittet
- docker-compose.yml har kommenterad ADMIN_TOKEN

---

## Checklista innan commit
- [ ] `npm run dev` startar frontend + backend utan fel
- [ ] CSV-import fungerar (Facebook + Instagram + Reach + GA Listens)
- [ ] Alla flikar renderar korrekt (Per konto, Per inlägg, Per inläggstyp, Trendanalys, Databas)
- [ ] Export till CSV/Excel fungerar
- [ ] `docker compose up --build` bygger och kör
- [ ] `curl -I http://localhost:3001/api/health` visar helmet-headers
- [ ] Rate limiting triggas vid snabba requests
