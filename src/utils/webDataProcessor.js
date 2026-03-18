/**
 * Web Data Processor
 * 
 * Webbversion av Instagram databearbetning som använder
 * webbläsarens API:er för att hantera och bearbeta data.
 */
import Papa from 'papaparse';
import { 
  saveProcessedData, 
  getAccountViewData, 
  getPostViewData
} from './webStorageService';
import { COLUMN_MAPPINGS as DEFAULT_MAPPINGS, getValue, normalizeText } from './columnConfig';

// Summeringsbara värden för "Per konto"-vy
const SUMMARIZABLE_COLUMNS = Object.values(DEFAULT_MAPPINGS).filter(col => [
  "views", "likes", "comments", "shares", "saves", "follows"
].includes(col));

// Metadata och icke-summeringsbara värden
const NON_SUMMARIZABLE_COLUMNS = Object.values(DEFAULT_MAPPINGS).filter(col => [
  "post_id", "account_id", "account_name", "account_username", "description",
  "publish_time", "date", "post_type", "permalink"
].includes(col));

/**
 * Formaterar datum till svenskt format (YYYY-MM-DD)
 */
function formatSwedishDate(date) {
  if (!date) return '';
  
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    
    return d.toLocaleDateString('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch (error) {
    console.error('Fel vid datumformatering:', error);
    return '';
  }
}

/**
 * Räknar unika konton i en datamängd
 * @param {Array} data - Datamängden att analysera
 * @returns {number} - Antal unika konton
 */
function countUniqueAccounts(data) {
  if (!Array.isArray(data) || data.length === 0) return 0;
  
  // Använd Set för att hålla unika account_id
  const uniqueAccountIds = new Set();
  
  data.forEach(row => {
    const accountId = getValue(row, 'account_id');
    if (accountId) {
      uniqueAccountIds.add(String(accountId));
    }
  });
  
  return uniqueAccountIds.size;
}

/**
 * Identifierar och hanterar dubletter baserat på Post ID och fil-identifierare
 * Använder getValue för att stödja olika språk
 */
function handleDuplicates(data, columnMappings, existingData = [], currentFileIdentifier = null) {
  // Skapa en map för att hålla reda på unika post_ids + fil-identifierare
  const uniquePosts = new Map();
  const duplicateIds = new Set();
  let duplicateCount = 0;
  const totalRows = data.length + existingData.length;
  
  // Lägg först in befintliga data (om det finns)
  if (existingData && existingData.length > 0) {
    existingData.forEach(row => {
      const postId = getValue(row, 'post_id');
      // Hämta fil-identifierare för befintlig data
      const fileIdentifier = row._file_identifier || '';
      
      if (postId) {
        // Skapa en sammansatt nyckel av post_id och fil-identifierare
        const compositeKey = `${postId}|${fileIdentifier}`;
        uniquePosts.set(compositeKey, row);
      } else {
        // Om ingen post_id finns, använd hela raden som unik nyckel
        const rowStr = JSON.stringify(row);
        uniquePosts.set(rowStr, row);
      }
    });
  }
  
  // Gå igenom nya data och identifiera dubletter
  data.forEach(row => {
    // Använd getValue för att hitta post_id oavsett vilket språk CSV-filen är på
    const postId = getValue(row, 'post_id');
    
    if (postId) {
      // För nya data, använd den aktuella fil-identifieraren
      const compositeKey = `${postId}|${currentFileIdentifier}`;
      
      if (uniquePosts.has(compositeKey)) {
        // Detta skulle vara en dubblett inom samma fil, vilket vi vill filtrera bort
        duplicateCount++;
        duplicateIds.add(compositeKey);
      } else {
        uniquePosts.set(compositeKey, row);
      }
    } else {
      // Om ingen post_id finns, använd hela raden som unik nyckel
      const rowStr = JSON.stringify(row);
      if (uniquePosts.has(rowStr)) {
        duplicateCount++;
      } else {
        uniquePosts.set(rowStr, row);
      }
    }
  });
  
  // Konvertera Map till array av unika rader
  const uniqueData = Array.from(uniquePosts.values());
  
  return {
    filteredData: uniqueData,
    stats: {
      totalRows,
      duplicates: duplicateCount,
      duplicateIds: Array.from(duplicateIds)
    }
  };
}

/**
 * Mappar CSV-kolumnnamn till interna namn med hjälp av kolumnmappningar
 * Använder bara exakta matchningar från användarkonfigurerade mappningar
 */
function mapColumnNames(row, columnMappings) {
  const mappedRow = {};
  
  Object.entries(row).forEach(([originalCol, value]) => {
    // Hitta matchande mappning via normaliserad textjämförelse
    const normalizedCol = normalizeText(originalCol);
    
    let internalName = null;
    for (const [mapKey, mapValue] of Object.entries(columnMappings)) {
      if (normalizeText(mapKey) === normalizedCol) {
        internalName = mapValue;
        break;
      }
    }
    
    // Om ingen mappning hittades, behåll originalkolumnen som är
    if (!internalName) {
      internalName = originalCol;
    }
    
    mappedRow[internalName] = value;
  });
  
  return mappedRow;
}

/**
 * Analyserar CSV-filen och returnerar basinformation (utan att bearbeta data)
 */
export async function analyzeCSVFile(csvContent) {
  return new Promise((resolve, reject) => {
    try {
      Papa.parse(csvContent, {
        header: true,
        preview: 5, // Analysera bara några rader för snabbhet
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            reject(new Error('Ingen data hittades i CSV-filen.'));
            return;
          }
          
          // Uppskatta totalt antal rader (approximativt)
          const linesCount = csvContent.split('\n').length - 1; // -1 för rubrikraden
          
          resolve({
            columns: Object.keys(results.data[0]).length,
            columnNames: Object.keys(results.data[0]),
            rows: linesCount,
            sampleData: results.data.slice(0, 3), // Några exempel
            fileSize: csvContent.length,
            fileSizeKB: Math.round(csvContent.length / 1024)
          });
        },
        error: (error) => {
          console.error('Fel vid CSV-analys:', error);
          reject(error);
        }
      });
    } catch (error) {
      console.error('Oväntat fel vid analys:', error);
      reject(error);
    }
  });
}

/**
 * Bearbetar CSV-innehåll och returnerar aggregerad data
 */
export async function processInstagramData(csvContent, columnMappings, shouldMergeWithExisting = false, fileName = 'Instagram CSV') {
  return new Promise(async (resolve, reject) => {
    try {
      // Om vi ska slå samman med befintlig data, hämta den först
      let existingPostData = [];
      let existingAccountData = [];
      
      if (shouldMergeWithExisting) {
        try {
          existingPostData = await getPostViewData() || [];
          existingAccountData = await getAccountViewData() || [];
          console.log('Befintlig data hämtad för sammanslagning:', {
            postCount: existingPostData.length,
            accountCount: existingAccountData.length
          });
        } catch (error) {
          console.warn('Kunde inte hämta befintlig data:', error);
          // Fortsätt ändå med tomma arrayer
        }
      }
      
      // Generera en unik fil-identifierare baserad på filnamn och aktuell tidsstämpel
      // Ta bort icke-alfanumeriska tecken för att säkerställa att det är en ren identifierare
      const fileIdentifier = `${fileName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
      
      Papa.parse(csvContent, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            reject(new Error('Ingen data hittades i CSV-filen.'));
            return;
          }
          
          console.log('CSV-data analyserad:', {
            rows: results.data.length,
            columns: Object.keys(results.data[0]).length
          });
          
          // Räkna unika konton i den nya filen INNAN sammanslagningen
          // Detta löser problem 2 - räkna unika konton per fil
          const uniqueAccountsInFile = countUniqueAccounts(results.data);
          
          // Identifiera och filtrera dubletter med tillgång till kolumnmappningar
          const { filteredData, stats } = handleDuplicates(
            results.data, 
            columnMappings,
            shouldMergeWithExisting ? existingPostData : [],
            fileIdentifier // Skicka fil-identifieraren för duplettkontroll
          );
          
          console.log('Dubbletthantering klar:', {
            originalRows: stats.totalRows,
            filteredRows: filteredData.length,
            duplicatesRemoved: stats.duplicates
          });
          
          let perKonto = {};
          let perPost = [];
          
          // Hitta datumintervall
          let allDates = [];
          
          // Om vi sammanfogar med befintlig data, starta med den
          if (shouldMergeWithExisting && existingPostData.length > 0) {
            perPost = [...existingPostData];
            
            // Extrahera datumintervall från befintlig data
            existingPostData.forEach(post => {
              const publishDate = getValue(post, 'publish_time') || 
                                 getValue(post, 'date') || 
                                 post['Publiceringstid'] || 
                                 post['Datum'];
              
              if (publishDate) {
                const date = new Date(publishDate);
                if (!isNaN(date.getTime())) {
                  allDates.push(date);
                }
              }
            });
            
            // Skapa konton från befintlig data
            existingAccountData.forEach(account => {
              const accountID = account.account_id;
              if (accountID) {
                perKonto[accountID] = { ...account };
              }
            });
          }
          
          // Bearbeta varje unik rad från nya data
          filteredData.forEach(row => {
            // Hoppa över om raden redan finns i perPost (duplicate check)
            // Detta är en extra säkerhet utöver handleDuplicates
            const postId = getValue(row, 'post_id');
            // Uppdaterad kontroll som använder både post_id och fil-identifierare
            if (postId && perPost.some(p => getValue(p, 'post_id') === postId && p._file_identifier === fileIdentifier)) {
              return;
            }
            
            // Mappa kolumnnamn till interna namn
            const mappedRow = mapColumnNames(row, columnMappings);
            
            // Lägg till fil-identifierare till den mappade raden
            mappedRow._file_identifier = fileIdentifier;
            
            // Använd getValue för att få accountID för att säkerställa att vi använder rätt fält
            const accountID = getValue(mappedRow, 'account_id') || 'unknown';
            
            if (!accountID) return;
            
            // Använd getValue för att säkerställa att account_name finns
            const accountName = getValue(mappedRow, 'account_name') || 'Okänt konto';
            const accountUsername = getValue(mappedRow, 'account_username') || '-';
            
            // Samla in publiceringsdatum för datumintervall
            const publishDate = getValue(mappedRow, 'publish_time') || 
                               getValue(mappedRow, 'date') || 
                               mappedRow['Publiceringstid'] || 
                               mappedRow['Datum'];
            
            if (publishDate) {
              const date = new Date(publishDate);
              if (!isNaN(date.getTime())) {
                allDates.push(date);
              }
            }
            
            // Skapa konto-objekt om det inte finns
            if (!perKonto[accountID]) {
              perKonto[accountID] = { 
                "account_id": accountID,
                "account_name": accountName,
                "account_username": accountUsername
              };
              SUMMARIZABLE_COLUMNS.forEach(col => perKonto[accountID][col] = 0);
            }
            
            // Beräkna engagement_total (likes + comments + shares)
            const likes = parseFloat(getValue(mappedRow, 'likes')) || 0;
            const comments = parseFloat(getValue(mappedRow, 'comments')) || 0;
            const shares = parseFloat(getValue(mappedRow, 'shares')) || 0;
            mappedRow["engagement_total"] = likes + comments + shares;
            
            // Summera värden
            SUMMARIZABLE_COLUMNS.forEach(col => {
              const value = getValue(mappedRow, col);
              if (value !== null && !isNaN(parseFloat(value))) {
                perKonto[accountID][col] += parseFloat(value);
              }
            });
            
            // Spara per inlägg-data
            perPost.push(mappedRow);
          });
          
          // Beräkna datumintervall
          let dateRange = { startDate: null, endDate: null };
          
          if (allDates.length > 0) {
            const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
            const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
            
            dateRange = {
              startDate: formatSwedishDate(minDate),
              endDate: formatSwedishDate(maxDate)
            };
          }
          
          // Beräkna totalt engagemang för varje konto
          Object.values(perKonto).forEach(account => {
            account.engagement_total = 
              (account.likes || 0) + 
              (account.comments || 0) + 
              (account.shares || 0);
              
            account.engagement_total_extended =
              (account.likes || 0) + 
              (account.comments || 0) + 
              (account.shares || 0) +
              (account.saves || 0) +
              (account.follows || 0);
          });
          
          // Konvertera till arrays
          const perKontoArray = Object.values(perKonto);
          
          // Skapa filmetadataobjekt för att spåra uppladdad fil
          const fileInfo = {
            filename: fileName || 'Instagram CSV', // Använd det riktiga filnamnet
            originalFileName: fileName || 'Instagram CSV', // Spara originalfilnamnet för dublettkontroll
            fileIdentifier: fileIdentifier, // Inkludera fil-identifieraren i metadata
            rowCount: results.data.length,
            duplicatesRemoved: stats.duplicates,
            // Använd det räknade värdet för unika konton i filen istället för perKontoArray.length
            accountCount: uniqueAccountsInFile,
            dateRange
          };
          
          // Spara data via webStorageService
          saveProcessedData(perKontoArray, perPost, fileInfo)
            .then(() => {
              console.log('Bearbetning klar! Data sparad i webbläsaren.');
              resolve({
                accountViewData: perKontoArray,
                postViewData: perPost,
                rows: perPost,
                rowCount: perPost.length,
                meta: {
                  processedAt: new Date(),
                  stats: stats,
                  dateRange: dateRange,
                  isMergedData: shouldMergeWithExisting,
                  filename: fileName,
                  fileIdentifier: fileIdentifier // Inkludera fil-identifieraren i returnerad metadata
                }
              });
            })
            .catch((error) => {
              console.error('Kunde inte spara bearbetad data:', error);
              reject(error);
            });
        },
        error: (error) => {
          console.error('Fel vid CSV-parsning:', error);
          reject(error);
        }
      });
    } catch (error) {
      console.error('Oväntat fel vid bearbetning:', error);
      reject(error);
    }
  });
}

/**
 * Returnerar en lista med unika kontonamn från data
 */
export function getUniquePageNames(data) {
  if (!Array.isArray(data)) return [];
  
  // Extrahera och deduplicera kontonamn
  const accountNames = new Set();
  
  data.forEach(post => {
    const accountName = getValue(post, 'account_name');
    if (accountName) {
      accountNames.add(accountName);
    }
  });
  
  return Array.from(accountNames).sort();
}

/**
 * Exportfunktioner för användning i komponenter
 */
export { SUMMARIZABLE_COLUMNS, NON_SUMMARIZABLE_COLUMNS };