/**
 * Web Data Processor
 * 
 * Webbversion av Facebook databearbetning som använder
 * webbläsarens API:er för att hantera och bearbeta data.
 */
import Papa from 'papaparse';
import { 
  saveProcessedData, 
  getAccountViewData, 
  getPostViewData
} from './webStorageService';
import { COLUMN_MAPPINGS as DEFAULT_MAPPINGS, getValue, normalizeText } from './columnConfig';

// Fältaliaser för kompatibilitet med Facebook
const FIELD_ALIASES = {
  'page_id': 'account_id',
  'page_name': 'account_name',
  'reactions': 'likes',
  'engagement_total': 'total_engagement',
  'post_reach': 'reach',
  'impressions': 'views'
};

// Direkta mappningar för Facebook-specifika kolumnnamn
const FACEBOOK_DIRECT_MAPPINGS = {
  'Sid-id': 'account_id',
  'Sidnamn': 'account_name',
  'Visningar': 'views',
  'Räckvidd': 'reach',
  'Reaktioner': 'likes',
  'Kommentarer': 'comments',
  'Delningar': 'shares',
  'Reaktioner, kommentarer och delningar': 'total_engagement',
  'Totalt antal klick': 'total_clicks',
  'Länkklick': 'link_clicks',
  'Övriga klick': 'other_clicks',
  'Publiceringstid': 'publish_time',
  'Titel': 'description',      // Mappar Titel till description
  'Inläggstyp': 'post_type',
  'Permalänk': 'permalink',
  'Publicerings-id': 'post_id'
};

// Summeringsbara värden för "Per konto"-vy
const SUMMARIZABLE_COLUMNS = Object.values(DEFAULT_MAPPINGS).filter(col => [
  "views", "likes", "comments", "shares", "total_engagement", "total_clicks", "other_clicks", "link_clicks"
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
  
  // Använd Map för att hålla koll på unika konton baserat på normaliserat namn
  const uniqueAccounts = new Map();
  
  // Logga första raden för debugging
  if (data.length > 0) {
    console.log('Analyzing first row for account detection:', {
      firstRow: data[0],
      has_Sid_id: data[0]['Sid-id'] !== undefined,
      has_account_id: data[0]['account_id'] !== undefined,
      has_page_id: data[0]['page_id'] !== undefined
    });
  }
  
  data.forEach(row => {
    // Hämta konto-ID och namn
    let accountId = row['Sid-id'];
    if (accountId === undefined) {
      accountId = getValue(row, 'account_id');
      if (!accountId && row.page_id) {
        accountId = row.page_id;
      }
    }
    
    let accountName = row['Sidnamn'];
    if (accountName === undefined) {
      accountName = getValue(row, 'account_name');
    }
    
    if (!accountName) return;
    
    // Normalisera kontonamnet
    const normalizedName = accountName.toLowerCase().replace(/\s+/g, '');
    
    // Om detta kontonamn redan finns, använd det befintliga kontot
    if (!uniqueAccounts.has(normalizedName)) {
      uniqueAccounts.set(normalizedName, {
        id: accountId,
        name: accountName
      });
    }
  });
  
  // Logga resultat för debugging
  console.log('Found unique accounts by name:', uniqueAccounts.size);
  return uniqueAccounts.size || 1; // Fallback till 1 om inga konton hittas (bättre än 0)
}

/**
 * Identifierar och hanterar dubletter baserat på Post ID
 * Använder getValue för att stödja olika språk
 */
function handleDuplicates(data, columnMappings, existingData = []) {
  // Skapa en map för att hålla reda på unika post_ids
  const uniquePosts = new Map();
  const duplicateIds = new Set();
  let duplicateCount = 0;
  const totalRows = data.length + existingData.length;
  
  // Lägg först in befintliga data (om det finns)
  if (existingData && existingData.length > 0) {
    existingData.forEach(row => {
      const postId = getValue(row, 'post_id');
      
      if (postId) {
        const postIdStr = String(postId);
        uniquePosts.set(postIdStr, row);
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
      const postIdStr = String(postId);
      
      if (uniquePosts.has(postIdStr)) {
        duplicateCount++;
        duplicateIds.add(postIdStr);
      } else {
        uniquePosts.set(postIdStr, row);
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
 * Förbearbeta Facebook-rad innan mappning
 * @param {Object} row - Raden att förbearbeta
 */
function preprocessFacebookRow(row) {
  // Kontrollera vilka kolumner som finns i första raden
  console.log('PreprocessFacebookRow - Available columns:', Object.keys(row));
  console.log('PreprocessFacebookRow - Titel value:', row['Titel']);
  console.log('PreprocessFacebookRow - Beskrivning value:', row['Beskrivning']);
  
  // Skapa en kopia för att inte modifiera originalet
  const processedRow = { ...row };
  
  // För Facebook, använd alltid Titel som description
  if (processedRow['Titel'] !== undefined) {
    processedRow['description'] = processedRow['Titel'];
    console.log('PreprocessFacebookRow - Set description from Titel:', processedRow['description']);
  }
  
  return processedRow;
}

/**
 * Detekterar om en post är en omslagsfoto-uppdatering baserat på titel/beskrivning
 * @param {Object} row - Posten att kontrollera
 * @returns {boolean} - true om det är en omslagsfoto-uppdatering
 */
function isCoverPhotoUpdate(row) {
  const title = row['Titel'] || row['description'] || '';
  const postType = row['Inläggstyp'] || row['post_type'] || '';
  
  return (
    title.toLowerCase().includes('omslagsfoto') || 
    title.toLowerCase().includes('updated its cover') ||
    postType.toLowerCase().includes('cover_photo') ||
    title.toLowerCase().includes('uppdaterat sitt omslagsfoto')
  );
}

/**
 * Mappar CSV-kolumnnamn till interna namn med hjälp av kolumnmappningar
 * @param {Object} row - Raden att mappa
 * @param {Object} columnMappings - Användarkonfigurerade kolumnmappningar
 * @param {boolean} isFacebookData - Om det är Facebook-data
 * @returns {Object} - Mappade raden
 */
function mapColumnNames(row, columnMappings, isFacebookData = false) {
  const mappedRow = {};
  
  // För Facebook-data, förbearbeta för att sätta viktiga värden direkt
  if (isFacebookData) {
    // För debugging
    console.log('Facebook data detected, before mapping columns:', 
      Object.keys(row).includes('Titel') ? 'Has Titel' : 'No Titel',
      Object.keys(row).includes('Visningar') ? 'Has Visningar' : 'No Visningar'
    );
    
    // DIREKT ÖVERFÖRING AV FACEBOOK-SPECIFIKA FÄLT
    // Sätt description direkt om Titel finns
    if (row['Titel'] !== undefined) {
      mappedRow.description = row['Titel'];
      console.log('DIRECT SET: Using Titel as description:', mappedRow.description);
    }
    
    // Sätt views direkt om Visningar finns
    if (row['Visningar'] !== undefined) {
      mappedRow.views = row['Visningar'];
      console.log('DIRECT SET: Using Visningar as views:', mappedRow.views);
    }
    
    // Sätt account_id direkt om Sid-id finns
    if (row['Sid-id'] !== undefined) {
      mappedRow.account_id = row['Sid-id'];
      console.log('DIRECT SET: Using Sid-id as account_id:', mappedRow.account_id);
    }
    
    // Sätt account_name direkt om Sidnamn finns
    if (row['Sidnamn'] !== undefined) {
      mappedRow.account_name = row['Sidnamn'];
      console.log('DIRECT SET: Using Sidnamn as account_name:', mappedRow.account_name);
    }
  }
  
  // Standard mappning för övriga fält
  Object.entries(row).forEach(([originalCol, value]) => {
    // Hoppa över Facebook-specifika fält vi redan har behandlat
    if (isFacebookData && 
       (originalCol === 'Titel' && mappedRow.description !== undefined ||
        originalCol === 'Visningar' && mappedRow.views !== undefined ||
        originalCol === 'Sid-id' && mappedRow.account_id !== undefined ||
        originalCol === 'Sidnamn' && mappedRow.account_name !== undefined)) {
      return;
    }
    
    // Standardmappning via konfigurerade mappningar
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
  
  // Sista kontroll: om vi saknar description och har Titel, använd Titel
  if (mappedRow.description === undefined && row['Titel'] !== undefined) {
    mappedRow.description = row['Titel'];
    console.log('FALLBACK: Setting description from Titel:', mappedRow.description);
  }
  
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
 * Detekterar om en CSV-fil är från Facebook baserat på kolumnnamn
 * @param {Object} firstRow - Första raden i CSV-data
 * @returns {boolean} - true om det är Facebook-data
 */
function isFacebookData(firstRow) {
  // Kontrollera Facebook-specifika kolumner
  return firstRow && (
    firstRow['Sid-id'] !== undefined || 
    firstRow['Sidnamn'] !== undefined ||
    firstRow['Inläggstyp'] !== undefined
  );
}

/**
 * Genererar en unik nyckel för att identifiera konton baserat på både namn och ID
 * Löser problem när samma konto har olika ID:n
 */
function generateAccountKey(accountID, accountName, description = null) {
  // Säkerställ att accountID är en sträng
  const accountIDStr = accountID ? String(accountID) : '';
  
  // Skapa en normaliserad version av kontonamnet (ta bort mellanslag, använd bara lowercase)
  const normalizedName = accountName 
    ? accountName.toLowerCase().replace(/\s+/g, '')
    : '';
  
  // Särskild hantering av omslagsfoto-uppdateringar - använd endast kontonamnet som nyckel
  if (description && (
      description.toLowerCase().includes('omslagsfoto') || 
      description.toLowerCase().includes('updated its cover') ||
      description.toLowerCase().includes('uppdaterat sitt omslagsfoto')
    )) {
    return `name_${normalizedName}`;
  }
  
  // Om både ID och namn finns, använd en kombination
  if (accountIDStr && normalizedName) {
    // Prioritera kontonamnet, men lägg till ID för att skilja konton med helt identiska namn
    return `${normalizedName}_${accountIDStr.slice(-4)}`;
  }
  
  // Fallback: Om bara ID finns, använd det
  if (accountIDStr) {
    return `id_${accountIDStr}`;
  }
  
  // Sista utväg: Om bara namn finns, använd det
  if (normalizedName) {
    return `name_${normalizedName}`;
  }
  
  // Om inget finns, använd en timestamp som unik identifierare
  return `unknown_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Bearbetar CSV-innehåll och returnerar aggregerad data
 */
export async function processPostData(csvContent, columnMappings, shouldMergeWithExisting = false, fileName = 'Facebook CSV') {
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
      
      Papa.parse(csvContent, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            reject(new Error('Ingen data hittades i CSV-filen.'));
            return;
          }
          
          // Detektera om det är Facebook-data
          const isFromFacebook = isFacebookData(results.data[0]);
          console.log('Data source detected:', isFromFacebook ? 'Facebook' : 'Unknown', 'First row keys:', Object.keys(results.data[0]));
          
          // För Facebook, kontrollera alla kolumnnamn och deras värden (debugging)
          if (isFromFacebook && results.data.length > 0) {
            const firstRow = results.data[0];
            console.log('FACEBOOK DATA DETECTED - First row:', firstRow);
            
            // Kontrollera om det finns Visningar och Titel
            const hasVisningar = 'Visningar' in firstRow;
            const hasTitel = 'Titel' in firstRow;
            
            console.log('Column check:', { 
              hasVisningar, 
              hasTitel,
              visningarValue: hasVisningar ? firstRow['Visningar'] : undefined,
              titelValue: hasTitel ? firstRow['Titel'] : undefined
            });
          }
          
          console.log('CSV-data analyserad:', {
            rows: results.data.length,
            columns: Object.keys(results.data[0]).length
          });
          
          // Sök efter omslagsfoto-uppdateringar
          const coverPhotoUpdates = results.data.filter(row => 
            (row['Titel'] && row['Titel'].toLowerCase().includes('omslagsfoto')) ||
            (row['Titel'] && row['Titel'].toLowerCase().includes('uppdaterat sitt omslagsfoto'))
          );
          
          if (coverPhotoUpdates.length > 0) {
            console.log(`Hittade ${coverPhotoUpdates.length} omslagsfoto-uppdateringar`);
            
            // Logga den första för debugging
            if (coverPhotoUpdates.length > 0) {
              console.log('Exempel på omslagsfoto-uppdatering:', {
                Titel: coverPhotoUpdates[0]['Titel'],
                Sidnamn: coverPhotoUpdates[0]['Sidnamn'],
                'Sid-id': coverPhotoUpdates[0]['Sid-id'],
                Visningar: coverPhotoUpdates[0]['Visningar'],
                Reaktioner: coverPhotoUpdates[0]['Reaktioner'],
                Kommentarer: coverPhotoUpdates[0]['Kommentarer']
              });
            }
          }
          
          // För Facebook, förbearbeta data för att sätta description från Titel
          let processedData = results.data;
          if (isFromFacebook) {
            console.log('Preprocessing Facebook data for Titel handling');
            processedData = results.data.map(row => {
              if (row['Titel'] !== undefined) {
                // Skapa direkta kopior av viktiga fält
                return { 
                  ...row, 
                  // Sätt description direkt från Titel
                  description: row['Titel']
                };
              }
              return row;
            });
            
            // Debugging - kontrollera första raden efter förbearbetning
            if (processedData.length > 0) {
              console.log('After preprocessing, first row description:', 
                processedData[0].description,
                'Original Titel:', results.data[0]['Titel']
              );
            }
          }
          
          // Räkna unika konton i den nya filen INNAN sammanslagningen
          const uniqueAccountsInFile = countUniqueAccounts(processedData);
          console.log('Unika konton hittades:', uniqueAccountsInFile);
          
          // Identifiera och filtrera dubletter med tillgång till kolumnmappningar
          const { filteredData, stats } = handleDuplicates(
            processedData, 
            columnMappings,
            shouldMergeWithExisting ? existingPostData : []
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
              const accountName = account.account_name;
              
              // Använd den nya accountKey-funktionen för att generera nycklar
              const accountKey = generateAccountKey(accountID, accountName);
              
              if (accountKey) {
                perKonto[accountKey] = { ...account };
              }
            });
          }
          
          // Map för att hålla koll på konton som redan setts med samma namn
          const accountNameMap = new Map();
          
          // Skapa en map för normaliserade kontonamn -> primär kontonyckel
          const normalizedAccountNames = new Map();
          
          // Förkör filteredData för att identifiera huvudkonton baserat på kontonamn
          filteredData.forEach(row => {
            const accountName = row['Sidnamn'] || getValue(row, 'account_name') || 'Okänd sida';
            const normalizedName = accountName.toLowerCase().replace(/\s+/g, '');
            
            // För varje unikt normaliserat namn, välja det ID som har flest poster med "normal" engagemang
            // Detta hjälper oss att hitta det huvudsakliga konto-IDt för alla konton med samma namn
            if (!normalizedAccountNames.has(normalizedName)) {
              const accountID = row['Sid-id'] || getValue(row, 'account_id') || 'unknown';
              const accountKey = generateAccountKey(accountID, accountName);
              normalizedAccountNames.set(normalizedName, accountKey);
            }
          });
          
          // Bearbeta varje unik rad från nya data
          filteredData.forEach((row, index) => {
            // Hoppa över om raden redan finns i perPost (duplicate check)
            // Detta är en extra säkerhet utöver handleDuplicates
            const postId = getValue(row, 'post_id');
            if (postId && perPost.some(p => getValue(p, 'post_id') === postId)) {
              return;
            }
            
            // För debugging, kontrollera första raden
            const isFirstRow = index === 0;
            if (isFirstRow && isFromFacebook) {
              console.log('Processing first row of Facebook data:', row);
              console.log('Row Titel before mapping:', row['Titel']);
              console.log('Row description before mapping (if exists):', row['description']);
            }
            
            // Mappa kolumnnamn till interna namn
            const mappedRow = mapColumnNames(row, columnMappings, isFromFacebook);
            
            // För debugging, kontrollera mappat resultat
            if (isFirstRow && isFromFacebook) {
              console.log('Mapped row keys:', Object.keys(mappedRow));
              console.log('description value after mapping:', mappedRow.description);
              console.log('views value after mapping:', mappedRow.views);
            }
            
            // Använd getValue för att få accountID för att säkerställa att vi använder rätt fält
            const accountID = getValue(mappedRow, 'account_id') || 'unknown';
            
            if (!accountID) return;
            
            // Använd getValue för att säkerställa att account_name finns
            const accountName = getValue(mappedRow, 'account_name') || 'Okänd sida';
            
            // Hämta beskrivning för att kontrollera om det är en omslagsfoto-uppdatering
            const description = getValue(mappedRow, 'description') || '';
            
            // Ingen account_username i FB, men vi behåller fältet för kompabilitet
            const accountUsername = '';
            
            // Normalisera kontonamnet för konsolidering
            const normalizedName = accountName.toLowerCase().replace(/\s+/g, '');
            
            // Om detta är en omslagsfoto-uppdatering eller liknande specialpost, använd primär kontonyckel
            // baserat på det normaliserade namnet om det finns, annars skapa en kontonyckel baserat på namnet
            let accountKey;
            
            // Särskild hantering för omslagsfoto-uppdateringar
            if (isCoverPhotoUpdate(mappedRow)) {
              console.log(`Hanterar omslagsfoto-uppdatering för ${accountName}`);
              
              // Använd det primära konto-ID för detta kontonamn om vi har det
              if (normalizedAccountNames.has(normalizedName)) {
                accountKey = normalizedAccountNames.get(normalizedName);
                console.log(`Använder befintlig nyckel för ${accountName}: ${accountKey}`);
              } else {
                // Om inget primärt konto-ID finns, skapa ett baserat på namnet
                accountKey = `name_${normalizedName}`;
                console.log(`Skapar namnbaserad nyckel för ${accountName}: ${accountKey}`);
              }
            } else {
              // För vanliga inlägg, använd standardmetoden
              accountKey = generateAccountKey(accountID, accountName, description);
            }
            
            // Spåra kontonamn för debug och dubblettkontroll
            if (!accountNameMap.has(accountName)) {
              accountNameMap.set(accountName, accountKey);
            } else {
              // Om vi hittar ett konto med samma namn men annan nyckel, logga detta
              const existingKey = accountNameMap.get(accountName);
              if (existingKey !== accountKey) {
                console.log(`ACCOUNT DUPLICATE DETECTED: "${accountName}" has multiple IDs:`, {
                  existingKey,
                  newKey: accountKey,
                  accountID,
                  description: description.substring(0, 50) // Visa bara början av beskrivningen
                });
              }
            }
            
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
            if (!perKonto[accountKey]) {
              perKonto[accountKey] = { 
                "account_id": accountID,
                "account_name": accountName,
                "account_username": accountUsername
              };
              SUMMARIZABLE_COLUMNS.forEach(col => perKonto[accountKey][col] = 0);
            }
            
            // Summera värden
            SUMMARIZABLE_COLUMNS.forEach(col => {
              const value = getValue(mappedRow, col);
              if (value !== null && !isNaN(parseFloat(value))) {
                perKonto[accountKey][col] += parseFloat(value);
                
                // För debugging, spåra views-värden
                if (col === 'views' && isFirstRow) {
                  console.log(`Adding views value ${value} to account ${accountKey}`);
                }
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
          
          // Konvertera till arrays
          const perKontoArray = Object.values(perKonto);
          
          // Skapa filmetadataobjekt för att spåra uppladdad fil
          const fileInfo = {
            filename: fileName || 'Facebook CSV', // Använd det riktiga filnamnet
            originalFileName: fileName || 'Facebook CSV', // Spara originalfilnamnet för dublettkontroll
            rowCount: results.data.length,
            duplicatesRemoved: stats.duplicates,
            // Använd det räknade värdet för unika konton i filen
            accountCount: uniqueAccountsInFile,
            dateRange,
            isFromFacebook: isFromFacebook
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
                  isFromFacebook: isFromFacebook
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
 * Returnerar en lista med unika sidnamn från data
 */
export function getUniquePageNames(data) {
  if (!Array.isArray(data)) return [];
  
  // Extrahera och deduplicera sidnamn
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
export { SUMMARIZABLE_COLUMNS, NON_SUMMARIZABLE_COLUMNS, FIELD_ALIASES };