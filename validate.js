#!/usr/bin/env node
/**
 * Data Validation Script for Meta Analytics
 *
 * Independently reads CSV files with PapaParse, computes expected values,
 * then runs the app's processCSVData() and getValue() against the same files
 * and compares results field by field.
 *
 * Usage: node validate.js
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const { version } = require('./package.json');

// ---------------------------------------------------------------------------
// 1.  Inline copies of column config (independent of app code)
// ---------------------------------------------------------------------------
const FB_COLUMN_MAPPINGS = {
  "Publicerings-id": "post_id",
  "Sid-id": "account_id",
  "Sidnamn": "account_name",
  "Titel": "description",
  "Publiceringstid": "publish_time",
  "Inläggstyp": "post_type",
  "Permalänk": "permalink",
  "Visningar": "views",
  "Räckvidd": "reach",
  "Reaktioner, kommentarer och delningar": "interactions",
  "Reaktioner": "likes",
  "Kommentarer": "comments",
  "Delningar": "shares",
  "Totalt antal klick": "total_clicks",
  "Länkklick": "link_clicks",
  "Övriga klick": "other_clicks"
};

const IG_COLUMN_MAPPINGS = {
  "Publicerings-id": "post_id",
  "Konto-id": "account_id",
  "Kontots användarnamn": "account_username",
  "Kontonamn": "account_name",
  "Beskrivning": "description",
  "Publiceringstid": "publish_time",
  "Inläggstyp": "post_type",
  "Permalänk": "permalink",
  "Visningar": "views",
  "Räckvidd": "reach",
  "Gilla-markeringar": "likes",
  "Kommentarer": "comments",
  "Delningar": "shares",
  "Följer": "follows",
  "Sparade objekt": "saves"
};

const FB_SUMMARIZABLE = ["views", "likes", "comments", "shares", "total_clicks", "other_clicks", "link_clicks"];
const IG_SUMMARIZABLE = ["views", "likes", "comments", "shares", "saves", "follows"];

// ---------------------------------------------------------------------------
// 2.  Helper functions (independent reimplementation)
// ---------------------------------------------------------------------------
function norm(text) {
  if (text === null || text === undefined) return '';
  return String(text).trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function detectPlatform(headers) {
  const set = new Set(headers.map(h => norm(h)));
  if (set.has(norm('Sid-id')) || set.has(norm('Sidnamn'))) return 'facebook';
  if (set.has(norm('Konto-id')) || set.has(norm('Kontots användarnamn'))) return 'instagram';
  return null;
}

function mapRow(row, mappings) {
  const mapped = {};
  for (const [col, val] of Object.entries(row)) {
    const nc = norm(col);
    let internal = null;
    for (const [mk, mv] of Object.entries(mappings)) {
      if (norm(mk) === nc) { internal = mv; break; }
    }
    mapped[internal || col] = val;
  }
  return mapped;
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// 3.  Independent processing of a single CSV file
// ---------------------------------------------------------------------------
function independentProcess(csvContent) {
  const parsed = Papa.parse(csvContent, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true
  });
  const rows = parsed.data;
  if (!rows || rows.length === 0) throw new Error('No data');

  const headers = Object.keys(rows[0]);
  const platform = detectPlatform(headers);
  if (!platform) throw new Error('Unknown platform');

  const mappings = platform === 'facebook' ? FB_COLUMN_MAPPINGS : IG_COLUMN_MAPPINGS;
  const sumCols = platform === 'facebook' ? FB_SUMMARIZABLE : IG_SUMMARIZABLE;

  // Map all rows, apply English-column fallback, tag platform
  const mapped = [];
  const seenPostIds = new Set();
  let duplicateCount = 0;

  for (const raw of rows) {
    const m = mapRow(raw, mappings);

    // English-column fallback
    if (!m.account_id || m.account_id === '') {
      const fb = raw['Account ID'] || raw['account_id'];
      if (fb) m.account_id = fb;
    }
    if (!m.account_name || m.account_name === '') {
      const fb = raw['Account name'] || raw['account_name'];
      if (fb) m.account_name = fb;
    }
    if (!m.account_username || m.account_username === '') {
      const fb = raw['Account username'] || raw['account_username'];
      if (fb) m.account_username = fb;
    }

    m._platform = platform;

    // Deduplicate by post_id
    const pid = m.post_id;
    if (pid) {
      const key = String(pid);
      if (seenPostIds.has(key)) { duplicateCount++; continue; }
      seenPostIds.add(key);
    }

    // Calculate per-row interactions & engagement
    const likes = num(m.likes);
    const comments = num(m.comments);
    const shares = num(m.shares);
    m.interactions = likes + comments + shares;

    if (platform === 'facebook') {
      m.engagement = likes + comments + shares + num(m.total_clicks);
    } else {
      m.engagement = likes + comments + shares + num(m.saves) + num(m.follows);
    }

    mapped.push(m);
  }

  // Aggregate per account
  const accounts = {};
  for (const post of mapped) {
    const aid = post.account_id || 'unknown';
    const aname = post.account_name || 'unknown';
    const akey = `${(aname || '').toLowerCase().replace(/\s+/g, '')}_${String(aid).slice(-4)}`;

    if (!accounts[akey]) {
      accounts[akey] = {
        account_id: aid,
        account_name: aname,
        _platform: platform,
        post_count: 0
      };
      for (const c of sumCols) accounts[akey][c] = 0;
    }
    accounts[akey].post_count++;
    for (const c of sumCols) {
      accounts[akey][c] += num(post[c]);
    }
  }

  // Calculate account-level interactions & engagement
  for (const acc of Object.values(accounts)) {
    acc.interactions = (acc.likes || 0) + (acc.comments || 0) + (acc.shares || 0);
    if (platform === 'facebook') {
      acc.engagement = acc.interactions + (acc.total_clicks || 0);
    } else {
      acc.engagement = acc.interactions + (acc.saves || 0) + (acc.follows || 0);
    }
  }

  return {
    platform,
    posts: mapped,
    accounts: Object.values(accounts),
    duplicateCount,
    totalRows: rows.length,
    uniqueAccountCount: Object.keys(accounts).length
  };
}

// ---------------------------------------------------------------------------
// 4.  Shimmed app imports (processCSVData uses browser APIs we need to mock)
// ---------------------------------------------------------------------------
function loadAppModules() {
  // Mock browser APIs that storageService.js expects
  global.localStorage = (() => {
    const store = {};
    return {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; }
    };
  })();

  global.indexedDB = undefined; // signal to storageService that IDB is unavailable

  // We need to transpile ESM → CJS on the fly.
  // Use a simple approach: read the source and rewrite exports/imports.
  function loadESM(filePath) {
    let code = fs.readFileSync(filePath, 'utf-8');

    // Remove import statements (single-line and multi-line)
    code = code.replace(/import\s+(?:[^;]*?from\s+)?['"][^'"]*['"];?/gs, '');

    // Convert export statements
    code = code.replace(/^export\s+const\s+/gm, 'const ');
    code = code.replace(/^export\s+function\s+/gm, 'function ');
    code = code.replace(/^export\s+async\s+function\s+/gm, 'async function ');
    code = code.replace(/^export\s+default\s+/gm, 'module.exports.default = ');

    return code;
  }

  // Load columnConfig
  const ccCode = loadESM(path.join(__dirname, 'src/utils/columnConfig.js'));
  const ccModule = {};
  const ccFunc = new Function('module', 'exports', 'require',
    ccCode + `
    module.exports = {
      FB_COLUMN_MAPPINGS, IG_COLUMN_MAPPINGS, DISPLAY_NAMES,
      ENGAGEMENT_INFO, INTERACTIONS_INFO,
      detectPlatform, getMappingsForPlatform, normalizeText,
      safeParseValue, findMatchingColumnKey, getValue, formatValue, formatDate
    };`
  );
  ccFunc(ccModule, ccModule.exports = {}, require);
  const columnConfig = ccModule.exports;

  // Load storageService (mock)
  const storageServiceMock = {
    saveProcessedData: async () => {},
    getAccountViewData: () => [],
    getPostViewData: async () => []
  };

  // Load webDataProcessor with injected deps
  let wdpCode = loadESM(path.join(__dirname, 'src/utils/webDataProcessor.js'));

  const wdpModule = {};
  const wdpFunc = new Function('module', 'exports', 'require', 'Papa',
    'saveProcessedData', 'getAccountViewData', 'getPostViewData',
    'FB_COLUMN_MAPPINGS', 'IG_COLUMN_MAPPINGS', 'detectPlatform',
    'getMappingsForPlatform', 'getValue', 'normalizeText', 'findMatchingColumnKey',
    wdpCode + `
    module.exports = { processCSVData, analyzeCSVFile, getUniquePageNames };`
  );
  wdpFunc(
    wdpModule, wdpModule.exports = {}, require, Papa,
    storageServiceMock.saveProcessedData,
    storageServiceMock.getAccountViewData,
    storageServiceMock.getPostViewData,
    columnConfig.FB_COLUMN_MAPPINGS,
    columnConfig.IG_COLUMN_MAPPINGS,
    columnConfig.detectPlatform,
    columnConfig.getMappingsForPlatform,
    columnConfig.getValue,
    columnConfig.normalizeText,
    columnConfig.findMatchingColumnKey
  );

  return {
    processCSVData: wdpModule.exports.processCSVData,
    getValue: columnConfig.getValue,
    columnConfig
  };
}

// ---------------------------------------------------------------------------
// 5.  Test runner
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ OK   ${label}`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL ${label}` + (detail ? `  —  ${detail}` : ''));
    failCount++;
  }
}

function approxEq(a, b, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

// ---------------------------------------------------------------------------
// 6.  Main
// ---------------------------------------------------------------------------
async function main() {
  const csvDir = path.join(__dirname, 'old_csv');
  const csvFiles = fs.readdirSync(csvDir).filter(f => f.endsWith('.csv'));

  if (csvFiles.length === 0) {
    console.error('Inga CSV-filer hittades i old_csv/');
    process.exit(1);
  }

  console.log(`Meta Analytics v${version} — datavalideringsskript`);
  console.log(`Hittade ${csvFiles.length} CSV-filer i old_csv/\n`);

  // Load app modules
  let app;
  try {
    app = loadAppModules();
  } catch (err) {
    console.error('Kunde inte ladda appens moduler:', err.message, '\n', err.stack);
    process.exit(1);
  }

  // Process each file
  for (const file of csvFiles) {
    const filePath = path.join(csvDir, file);
    const csvContent = fs.readFileSync(filePath, 'utf-8');

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Fil: ${file}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // --- Independent processing ---
    let indep;
    try {
      indep = independentProcess(csvContent);
    } catch (err) {
      console.log(`  ✗ FAIL Oberoende bearbetning misslyckades: ${err.message}`);
      failCount++;
      continue;
    }

    // --- App processing ---
    let appResult;
    try {
      appResult = await app.processCSVData(csvContent, false, file);
    } catch (err) {
      console.log(`  ✗ FAIL App-bearbetning misslyckades: ${err.message}`);
      failCount++;
      continue;
    }

    const appPosts = appResult.postViewData;
    const appAccounts = appResult.accountViewData;

    // ===== CHECK 1: Platform detection =====
    console.log('\n  [Plattformsdetektering]');
    check(
      `Plattform = ${indep.platform}`,
      appResult.meta.platform === indep.platform,
      `App: ${appResult.meta.platform}, Förväntat: ${indep.platform}`
    );

    // ===== CHECK 2: _platform set on every post =====
    console.log('\n  [_platform på varje rad]');
    const allHavePlatform = appPosts.every(p => p._platform === indep.platform);
    check(
      `Alla ${appPosts.length} poster har _platform="${indep.platform}"`,
      allHavePlatform,
      `${appPosts.filter(p => p._platform !== indep.platform).length} poster saknar korrekt _platform`
    );

    // ===== CHECK 3: No duplicate post_ids =====
    console.log('\n  [Dubbletter]');
    const appPostIds = appPosts.map(p => app.getValue(p, 'post_id')).filter(Boolean).map(String);
    const appUniqueIds = new Set(appPostIds);
    check(
      `Inga dubblerade post_id (${appUniqueIds.size}/${appPostIds.length})`,
      appUniqueIds.size === appPostIds.length,
      `${appPostIds.length - appUniqueIds.size} dubbletter hittades`
    );

    // Cross-check with independent count
    check(
      `Antal poster matchar: app=${appPosts.length} indep=${indep.posts.length}`,
      appPosts.length === indep.posts.length,
      `App: ${appPosts.length}, Indep: ${indep.posts.length}`
    );

    // ===== CHECK 4: Unique accounts per platform =====
    console.log('\n  [Unika konton]');
    check(
      `Antal konton: app=${appAccounts.length} indep=${indep.uniqueAccountCount}`,
      appAccounts.length === indep.uniqueAccountCount,
      `App: ${appAccounts.length}, Indep: ${indep.uniqueAccountCount}`
    );

    // ===== CHECK 5: English column fallback =====
    console.log('\n  [Engelska kolumner – fallback]');
    const postsWithoutAccountId = appPosts.filter(p => !app.getValue(p, 'account_id') || app.getValue(p, 'account_id') === '');
    check(
      `Alla poster har account_id (${appPosts.length - postsWithoutAccountId.length}/${appPosts.length})`,
      postsWithoutAccountId.length === 0,
      `${postsWithoutAccountId.length} poster saknar account_id`
    );

    const postsWithoutAccountName = appPosts.filter(p => {
      const name = app.getValue(p, 'account_name');
      return !name || name === '' || name === 'Okänd sida' || name === 'Okänt konto';
    });
    check(
      `Alla poster har account_name`,
      postsWithoutAccountName.length === 0,
      `${postsWithoutAccountName.length} poster saknar account_name`
    );

    // ===== CHECK 6: Per-account sums =====
    console.log('\n  [Summor per konto]');
    const sumCols = indep.platform === 'facebook' ? FB_SUMMARIZABLE : IG_SUMMARIZABLE;

    // Build lookup by account_id for both sides
    const indepByAid = {};
    for (const a of indep.accounts) indepByAid[String(a.account_id)] = a;

    const appByAid = {};
    for (const a of appAccounts) appByAid[String(a.account_id)] = a;

    let sumMismatch = false;
    for (const [aid, iAcc] of Object.entries(indepByAid)) {
      const aAcc = appByAid[aid];
      if (!aAcc) {
        check(`Konto ${aid} (${iAcc.account_name}) finns i app-resultat`, false, 'Saknas');
        sumMismatch = true;
        continue;
      }

      for (const col of sumCols) {
        const iVal = iAcc[col] || 0;
        const aVal = aAcc[col] || 0;
        if (!approxEq(iVal, aVal)) {
          check(
            `${iAcc.account_name} → ${col}`,
            false,
            `App: ${aVal}, Indep: ${iVal}`
          );
          sumMismatch = true;
        }
      }

      // Post count
      if (iAcc.post_count !== undefined) {
        const appPostCount = appPosts.filter(p => String(app.getValue(p, 'account_id')) === aid).length;
        if (iAcc.post_count !== appPostCount) {
          check(
            `${iAcc.account_name} → antal inlägg`,
            false,
            `App: ${appPostCount}, Indep: ${iAcc.post_count}`
          );
          sumMismatch = true;
        }
      }
    }

    if (!sumMismatch) {
      check(
        `Alla summor per konto (${sumCols.join(', ')}) stämmer`,
        true
      );
    }

    // ===== CHECK 7: Engagement per account =====
    console.log('\n  [Engagemang per konto]');
    let engMismatch = false;
    for (const [aid, iAcc] of Object.entries(indepByAid)) {
      const aAcc = appByAid[aid];
      if (!aAcc) continue;

      // Interactions
      if (!approxEq(iAcc.interactions, aAcc.interactions || 0)) {
        check(
          `${iAcc.account_name} → interactions`,
          false,
          `App: ${aAcc.interactions}, Indep: ${iAcc.interactions}`
        );
        engMismatch = true;
      }

      // Engagement
      if (!approxEq(iAcc.engagement, aAcc.engagement || 0)) {
        check(
          `${iAcc.account_name} → engagement`,
          false,
          `App: ${aAcc.engagement}, Indep: ${iAcc.engagement}`
        );
        engMismatch = true;
      }
    }
    if (!engMismatch) {
      const formula = indep.platform === 'facebook'
        ? 'likes+comments+shares+total_clicks'
        : 'likes+comments+shares+saves+follows';
      check(
        `Engagemang korrekt beräknat (${formula})`,
        true
      );
      check(
        `Interaktioner korrekt beräknade (likes+comments+shares)`,
        true
      );
    }

    // ===== CHECK 8: Per-post engagement via getValue() =====
    console.log('\n  [Per-post engagement via getValue()]');
    let postEngErrors = 0;
    const sampleSize = Math.min(50, appPosts.length);
    for (let i = 0; i < sampleSize; i++) {
      const post = appPosts[i];
      const likes = num(app.getValue(post, 'likes'));
      const comments = num(app.getValue(post, 'comments'));
      const shares = num(app.getValue(post, 'shares'));

      // Check interactions
      const expectedInteractions = likes + comments + shares;
      const gotInteractions = num(app.getValue(post, 'interactions'));
      if (!approxEq(expectedInteractions, gotInteractions)) postEngErrors++;

      // Check engagement
      let expectedEngagement;
      if (post._platform === 'facebook') {
        expectedEngagement = likes + comments + shares + num(app.getValue(post, 'total_clicks'));
      } else {
        expectedEngagement = likes + comments + shares + num(app.getValue(post, 'saves')) + num(app.getValue(post, 'follows'));
      }
      const gotEngagement = num(app.getValue(post, 'engagement'));
      if (!approxEq(expectedEngagement, gotEngagement)) postEngErrors++;
    }
    check(
      `getValue() engagement/interactions korrekt (${sampleSize} poster kontrollerade)`,
      postEngErrors === 0,
      `${postEngErrors} avvikelser`
    );

    // ===== CHECK 9: reach and views sums =====
    console.log('\n  [Reach & views totalt]');
    const indepTotalReach = indep.posts.reduce((s, p) => s + num(p.reach), 0);
    const appTotalReach = appPosts.reduce((s, p) => s + num(app.getValue(p, 'reach')), 0);
    check(
      `Total reach: app=${appTotalReach} indep=${indepTotalReach}`,
      approxEq(indepTotalReach, appTotalReach),
      `Differens: ${Math.abs(appTotalReach - indepTotalReach)}`
    );

    const indepTotalViews = indep.posts.reduce((s, p) => s + num(p.views), 0);
    const appTotalViews = appPosts.reduce((s, p) => s + num(app.getValue(p, 'views')), 0);
    check(
      `Total views: app=${appTotalViews} indep=${indepTotalViews}`,
      approxEq(indepTotalViews, appTotalViews),
      `Differens: ${Math.abs(appTotalViews - indepTotalViews)}`
    );

    console.log('');
  }

  // ===== CROSS-FILE DUPLICATE CHECK =====
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Kontroll: dubbletter mellan filer`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const allPostIds = new Map(); // post_id → filename
  let crossFileDupes = 0;
  for (const file of csvFiles) {
    const filePath = path.join(csvDir, file);
    const csvContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse(csvContent, { header: true, dynamicTyping: true, skipEmptyLines: true });
    for (const row of parsed.data) {
      const pid = row['Publicerings-id'];
      if (!pid) continue;
      const key = String(pid);
      if (allPostIds.has(key)) {
        crossFileDupes++;
      } else {
        allPostIds.set(key, file);
      }
    }
  }
  check(
    crossFileDupes === 0
      ? `Inga dubbletter mellan filer (${allPostIds.size} unika post_ids)`
      : `${crossFileDupes} dubbletter mellan filer upptäckta`,
    true // This is informational — duplicates across files are handled by dedup
  );

  // ===== MERGED PROCESSING CHECK =====
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Kontroll: sammanslagen bearbetning av alla filer`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Independently: merge all files, dedup by post_id globally
  const allPosts = [];
  const globalSeen = new Set();
  let globalDupes = 0;
  for (const file of csvFiles) {
    const filePath = path.join(csvDir, file);
    const csvContent = fs.readFileSync(filePath, 'utf-8');
    const indep = independentProcess(csvContent);
    for (const post of indep.posts) {
      const pid = String(post.post_id);
      if (globalSeen.has(pid)) { globalDupes++; continue; }
      globalSeen.add(pid);
      allPosts.push(post);
    }
  }

  const fbPosts = allPosts.filter(p => p._platform === 'facebook');
  const igPosts = allPosts.filter(p => p._platform === 'instagram');
  console.log(`  Totalt ${allPosts.length} unika poster (FB: ${fbPosts.length}, IG: ${igPosts.length}), ${globalDupes} dubbletter borttagna`);

  // Count unique accounts
  const fbAccounts = new Set(fbPosts.map(p => String(p.account_id)));
  const igAccounts = new Set(igPosts.map(p => String(p.account_id)));
  console.log(`  FB-konton: ${fbAccounts.size}, IG-konton: ${igAccounts.size}`);

  check(
    `Alla poster har giltig _platform`,
    allPosts.every(p => p._platform === 'facebook' || p._platform === 'instagram'),
    `${allPosts.filter(p => !p._platform).length} poster utan plattform`
  );

  // ===== SUMMARY =====
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`RESULTAT: ${passCount} OK, ${failCount} FAIL`);
  console.log(`${'═'.repeat(50)}`);

  if (failCount > 0) {
    console.log('\n⚠  Avvikelser hittades! Se detaljer ovan.');
    process.exit(1);
  } else {
    console.log('\nAlla kontroller passerade.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Oväntat fel:', err);
  process.exit(1);
});
