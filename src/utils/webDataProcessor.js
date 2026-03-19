/**
 * Unified Web Data Processor for Meta Analytics
 *
 * Handles both Facebook and Instagram CSV parsing with normalized field names.
 */
import Papa from 'papaparse';
import {
  saveProcessedData,
  getAccountViewData,
  getPostViewData
} from './storageService';
import {
  FB_COLUMN_MAPPINGS,
  IG_COLUMN_MAPPINGS,
  detectPlatform,
  getMappingsForPlatform,
  getValue,
  normalizeText,
  findMatchingColumnKey
} from './columnConfig';

// Fields that can be summed per account
const FB_SUMMARIZABLE = ["views", "likes", "comments", "shares", "total_clicks", "other_clicks", "link_clicks"];
const IG_SUMMARIZABLE = ["views", "likes", "comments", "shares", "saves", "follows"];

function formatSwedishDate(date) {
  if (!date) return '';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (error) {
    return '';
  }
}

function countUniqueAccounts(data) {
  if (!Array.isArray(data) || data.length === 0) return 0;
  const unique = new Set();
  data.forEach(row => {
    const id = getValue(row, 'account_id');
    if (id) unique.add(String(id));
    else {
      const name = getValue(row, 'account_name');
      if (name) unique.add(name.toLowerCase().replace(/\s+/g, ''));
    }
  });
  return unique.size || 1;
}

function handleDuplicates(data, existingData = []) {
  const uniquePosts = new Map();
  let duplicateCount = 0;
  const totalRows = data.length + existingData.length;

  if (existingData.length > 0) {
    existingData.forEach(row => {
      const postId = getValue(row, 'post_id');
      if (postId) uniquePosts.set(String(postId), row);
      else uniquePosts.set(JSON.stringify(row), row);
    });
  }

  data.forEach(row => {
    const postId = getValue(row, 'post_id');
    if (postId) {
      const key = String(postId);
      if (uniquePosts.has(key)) duplicateCount++;
      else uniquePosts.set(key, row);
    } else {
      const key = JSON.stringify(row);
      if (uniquePosts.has(key)) duplicateCount++;
      else uniquePosts.set(key, row);
    }
  });

  return {
    filteredData: Array.from(uniquePosts.values()),
    stats: { totalRows, duplicates: duplicateCount }
  };
}

function mapColumnNames(row, columnMappings) {
  const mappedRow = {};
  Object.entries(row).forEach(([originalCol, value]) => {
    const normalizedCol = normalizeText(originalCol);
    let internalName = null;
    for (const [mapKey, mapValue] of Object.entries(columnMappings)) {
      if (normalizeText(mapKey) === normalizedCol) {
        internalName = mapValue;
        break;
      }
    }
    mappedRow[internalName || originalCol] = value;
  });
  return mappedRow;
}

function generateAccountKey(accountID, accountName) {
  const idStr = accountID ? String(accountID) : '';
  const normalizedName = accountName ? accountName.toLowerCase().replace(/\s+/g, '') : '';
  if (idStr && normalizedName) return `${normalizedName}_${idStr.slice(-4)}`;
  if (idStr) return `id_${idStr}`;
  if (normalizedName) return `name_${normalizedName}`;
  return `unknown_${Date.now()}`;
}

export async function analyzeCSVFile(csvContent) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvContent, {
      header: true,
      preview: 5,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          reject(new Error('Ingen data hittades i CSV-filen.'));
          return;
        }
        const linesCount = csvContent.split('\n').length - 1;
        resolve({
          columns: Object.keys(results.data[0]).length,
          columnNames: Object.keys(results.data[0]),
          rows: linesCount,
          sampleData: results.data.slice(0, 3),
          fileSize: csvContent.length,
          fileSizeKB: Math.round(csvContent.length / 1024)
        });
      },
      error: (error) => reject(error)
    });
  });
}

/**
 * Main processing function - handles both Facebook and Instagram CSV
 */
export async function processCSVData(csvContent, shouldMergeWithExisting = false, fileName = 'CSV') {
  return new Promise(async (resolve, reject) => {
    try {
      let existingPostData = [];
      let existingAccountData = [];

      if (shouldMergeWithExisting) {
        try {
          existingPostData = await getPostViewData() || [];
          existingAccountData = getAccountViewData() || [];
        } catch (error) {
          console.warn('Could not fetch existing data:', error);
        }
      }

      Papa.parse(csvContent, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            reject(new Error('Ingen data hittades i CSV-filen.'));
            return;
          }

          const headers = Object.keys(results.data[0]);
          const platform = detectPlatform(headers);

          if (!platform) {
            reject(new Error('Kunde inte identifiera plattform (Facebook eller Instagram) från CSV-kolumnerna.'));
            return;
          }

          const columnMappings = getMappingsForPlatform(platform);
          const summarizableColumns = platform === 'facebook' ? FB_SUMMARIZABLE : IG_SUMMARIZABLE;
          const uniqueAccountsInFile = countUniqueAccounts(results.data);

          // Handle Facebook-specific preprocessing
          let processedData = results.data;
          if (platform === 'facebook') {
            processedData = results.data.map(row => {
              if (row['Titel'] !== undefined) {
                return { ...row, description: row['Titel'] };
              }
              return row;
            });
          }

          const { filteredData, stats } = handleDuplicates(
            processedData,
            shouldMergeWithExisting ? existingPostData : []
          );

          let perKonto = {};
          let perPost = [];
          let allDates = [];

          // Seed from existing data if merging
          if (shouldMergeWithExisting && existingPostData.length > 0) {
            perPost = [...existingPostData];
            existingPostData.forEach(post => {
              const publishDate = getValue(post, 'publish_time');
              if (publishDate) {
                const date = new Date(publishDate);
                if (!isNaN(date.getTime())) allDates.push(date);
              }
            });
            existingAccountData.forEach(account => {
              const key = generateAccountKey(account.account_id, account.account_name);
              if (key) perKonto[key] = { ...account };
            });
          }

          // Process each row
          filteredData.forEach((row) => {
            const postId = getValue(row, 'post_id');
            if (postId && perPost.some(p => getValue(p, 'post_id') === postId)) return;

            const mappedRow = mapColumnNames(row, columnMappings);

            // Fallback: Meta exports sometimes have empty Swedish columns
            // but filled English columns (positions 18-20 in header).
            // Raw row still has the original column names as keys.
            if (!mappedRow.account_id || mappedRow.account_id === '') {
              const fallbackId = row['Account ID'] || row['account_id'];
              if (fallbackId) mappedRow.account_id = fallbackId;
            }
            if (!mappedRow.account_name || mappedRow.account_name === '') {
              const fallbackName = row['Account name'] || row['account_name'];
              if (fallbackName) mappedRow.account_name = fallbackName;
            }
            if (!mappedRow.account_username || mappedRow.account_username === '') {
              const fallbackUsername = row['Account username'] || row['account_username'];
              if (fallbackUsername) mappedRow.account_username = fallbackUsername;
            }

            // Tag with platform
            mappedRow._platform = platform;

            // For Facebook: ensure description from Titel
            if (platform === 'facebook' && mappedRow.description === undefined && row['Titel'] !== undefined) {
              mappedRow.description = row['Titel'];
            }

            const accountID = getValue(mappedRow, 'account_id') || 'unknown';
            const accountName = getValue(mappedRow, 'account_name') || (platform === 'facebook' ? 'Okänd sida' : 'Okänt konto');
            const accountUsername = getValue(mappedRow, 'account_username') || '';
            const accountKey = generateAccountKey(accountID, accountName);

            // Collect publish dates
            const publishDate = getValue(mappedRow, 'publish_time');
            if (publishDate) {
              const date = new Date(publishDate);
              if (!isNaN(date.getTime())) allDates.push(date);
            }

            // Create account entry
            if (!perKonto[accountKey]) {
              perKonto[accountKey] = {
                account_id: accountID,
                account_name: accountName,
                account_username: accountUsername,
                _platform: platform
              };
              summarizableColumns.forEach(col => perKonto[accountKey][col] = 0);
            }

            // Calculate interactions (likes + comments + shares)
            const likes = parseFloat(getValue(mappedRow, 'likes')) || 0;
            const comments = parseFloat(getValue(mappedRow, 'comments')) || 0;
            const shares = parseFloat(getValue(mappedRow, 'shares')) || 0;
            mappedRow.interactions = likes + comments + shares;

            // Calculate engagement based on platform
            if (platform === 'facebook') {
              const totalClicks = parseFloat(getValue(mappedRow, 'total_clicks')) || 0;
              mappedRow.engagement = likes + comments + shares + totalClicks;
            } else {
              const saves = parseFloat(getValue(mappedRow, 'saves')) || 0;
              const follows = parseFloat(getValue(mappedRow, 'follows')) || 0;
              mappedRow.engagement = likes + comments + shares + saves + follows;
            }

            // Sum values per account
            summarizableColumns.forEach(col => {
              const value = getValue(mappedRow, col);
              if (value !== null && !isNaN(parseFloat(value))) {
                perKonto[accountKey][col] += parseFloat(value);
              }
            });

            perPost.push(mappedRow);
          });

          // Detect collab posts: accounts with very few posts compared to majority.
          // A collab post appears as a "foreign" account_id among the main accounts.
          const accountPostCounts = {};
          for (const post of perPost) {
            const aid = post.account_id;
            if (!aid) continue;
            accountPostCounts[aid] = (accountPostCounts[aid] || 0) + 1;
          }

          // Flag accounts with 1–2 posts as potential collab.
          // Threshold of 2 catches e.g. Musik i Dalarna (2 posts) while
          // still avoiding false positives on real accounts with few posts.
          const collabThreshold = 2;

          // Accounts whose name contains any of these terms are never flagged as collab.
          const COLLAB_SAFE_TERMS = ['Sveriges Radio', 'P1', 'P2', 'P3', 'P4'];

          // Build id → name map for safe-term lookup
          const accountIdToName = {};
          for (const post of perPost) {
            if (post.account_id && post.account_name) {
              accountIdToName[post.account_id] = post.account_name;
            }
          }

          const collabAccountIds = new Set();
          for (const [aid, count] of Object.entries(accountPostCounts)) {
            if (count <= collabThreshold && Object.keys(accountPostCounts).length > 1) {
              const name = accountIdToName[aid] || '';
              const isSafe = COLLAB_SAFE_TERMS.some(term =>
                name.toLowerCase().includes(term.toLowerCase())
              );
              if (!isSafe) collabAccountIds.add(aid);
            }
          }

          for (const post of perPost) {
            if (collabAccountIds.has(post.account_id)) {
              post._isCollab = true;
            }
          }

          for (const key in perKonto) {
            if (collabAccountIds.has(perKonto[key].account_id)) {
              perKonto[key]._isCollab = true;
            }
          }

          // Calculate date range
          let dateRange = { startDate: null, endDate: null };
          if (allDates.length > 0) {
            const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
            const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
            dateRange = {
              startDate: formatSwedishDate(minDate),
              endDate: formatSwedishDate(maxDate)
            };
          }

          // Calculate account-level interactions and engagement
          Object.values(perKonto).forEach(account => {
            account.interactions =
              (account.likes || 0) +
              (account.comments || 0) +
              (account.shares || 0);

            if (account._platform === 'facebook') {
              account.engagement = account.interactions + (account.total_clicks || 0);
            } else {
              account.engagement =
                account.interactions +
                (account.saves || 0) +
                (account.follows || 0);
            }
          });

          const perKontoArray = Object.values(perKonto);

          const fileInfo = {
            filename: fileName,
            originalFileName: fileName,
            rowCount: results.data.length,
            duplicatesRemoved: stats.duplicates,
            accountCount: uniqueAccountsInFile,
            dateRange,
            platform
          };

          saveProcessedData(perKontoArray, perPost, fileInfo)
            .then(() => {
              resolve({
                accountViewData: perKontoArray,
                postViewData: perPost,
                rows: perPost,
                rowCount: perPost.length,
                meta: {
                  processedAt: new Date(),
                  stats,
                  dateRange,
                  isMergedData: shouldMergeWithExisting,
                  filename: fileName,
                  platform
                }
              });
            })
            .catch(reject);
        },
        error: (error) => reject(error)
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function getUniquePageNames(data) {
  if (!Array.isArray(data)) return [];
  const accountNames = new Set();
  data.forEach(post => {
    const name = getValue(post, 'account_name');
    if (name) accountNames.add(name);
  });
  return Array.from(accountNames).sort();
}
