import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import {
  UploadCloud,
  FileWarning,
  Loader2,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  X,
  RefreshCw
} from 'lucide-react';
import Papa from 'papaparse';
import PlatformBadge from '../ui/PlatformBadge';
import { api } from '@/utils/apiClient';
import { parseTikTokVideoUrl } from '@/utils/columnConfig';

// Svenska månadsord — används för att strippa månadsprefix från TikTok-filnamn
// (t.ex. "AprilP3_Din_GataVideo.csv" → "P3 Din Gata").
const SV_MONTH_PREFIXES = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
];

/**
 * Härled ett föreslaget display-namn ur ett TikTok-filnamn.
 * Mönster: "<Månad><Konto>Video.csv" eller "<Månad><Konto>_versikt.csv"
 * (versikt = "översikt" med stripat ö i URL-encoded filnamn).
 */
function suggestTikTokAccountName(filename) {
  if (!filename) return '';
  let s = filename.replace(/\.csv$/i, '');
  for (const m of SV_MONTH_PREFIXES) {
    if (s.startsWith(m)) { s = s.slice(m.length); break; }
  }
  s = s.replace(/Video$/i, '').replace(/_versikt$/i, '').replace(/_/g, ' ').trim();
  return s;
}

const FILE_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  ERROR: 'error'
};

export function FileUploader({ onImportComplete, onCancel }) {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchResult, setBatchResult] = useState(null);
  const fileInputRef = useRef(null);
  // Karta över TikTok-handles vi redan känner till — handle → display-namn.
  // Hämtas vid mount och uppdateras efter varje lyckad import. Används för att
  // (a) auto-föreslå konto för Översikt-filer, (b) auto-fylla display-namn för
  // Video-filer vars handle vi sett tidigare.
  const [tiktokAccounts, setTiktokAccounts] = useState({}); // handle → display_name

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Posts-baserade TikTok-konton (Video-import skapar dessa)
        const accountsRes = await api.getAccounts({ fields: 'post_count', platform: 'tiktok' }).catch(() => ({ accounts: [] }));
        // Översikt-baserade TikTok-konton
        const overviewRes = await api.getTikTokOverviewAccounts().catch(() => ({ accounts: [] }));
        if (cancelled) return;
        const map = {};
        for (const a of accountsRes.accounts || []) {
          if (a.account_username) map[a.account_username] = a.account_name || a.account_username;
        }
        for (const a of overviewRes.accounts || []) {
          if (a.account_username && !map[a.account_username]) {
            map[a.account_username] = a.account_name || a.account_username;
          }
        }
        setTiktokAccounts(map);
      } catch (e) {
        // Tyst — användaren kan ändå skriva in nytt konto manuellt.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const addFiles = useCallback(async (newFiles) => {
    const csvFiles = Array.from(newFiles).filter(
      f => f.type === 'text/csv' || f.name.endsWith('.csv')
    );
    if (csvFiles.length === 0) return;

    const fileEntries = [];

    for (const file of csvFiles) {
      // Read first 4KB to detect file type
      const { headers: preview, firstRow } = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = Papa.parse(e.target.result, { header: true, preview: 1 });
          resolve({
            headers: result.meta?.fields || [],
            firstRow: result.data?.[0] || {},
          });
        };
        reader.readAsText(file.slice(0, 4096));
      });

      // TikTok Video-CSV: Videotitel + Videolänk + Videovisningar (eller engelska motsvarigheter).
      // Unik kombo, ingen kollision med Meta-exporter.
      const previewSet = new Set(preview.map(h => (h || '').trim()));
      const isTikTokVideo =
        (previewSet.has('Videotitel') || previewSet.has('Video title')) &&
        (previewSet.has('Videolänk') || previewSet.has('Video link')) &&
        (previewSet.has('Videovisningar') || previewSet.has('Video views'));

      // TikTok Översikt-CSV: Datum + Målgrupp som nåtts + Profilvisningar.
      const isTikTokOverview = !isTikTokVideo &&
        (previewSet.has('Datum') || previewSet.has('Date')) &&
        (previewSet.has('Målgrupp som nåtts') || previewSet.has('Reached audience')) &&
        (previewSet.has('Profilvisningar') || previewSet.has('Profile views'));

      // Reach export: identified by the combination of Page, Page ID and Reach headers
      const isReach = !isTikTokVideo && !isTikTokOverview &&
                      preview.includes('Page') &&
                      preview.includes('Page ID') &&
                      preview.includes('Reach');

      // GA listens export: must have Programnamn and at least one listening column
      const isGaListens = !isReach && !isTikTokVideo && !isTikTokOverview &&
        preview.includes('Programnamn') &&
        preview.some(h => {
          const lower = h.toLowerCase();
          return lower.includes('lyssningar')
              || lower.includes('lyssnat')
              || lower.startsWith('starter');
        });

      // GA site visits export: must have Programnamn and a "besök" column
      const isGaSiteVisits = !isReach && !isGaListens && !isTikTokVideo && !isTikTokOverview &&
        preview.includes('Programnamn') &&
        preview.some(h => h.toLowerCase().includes('besök'));

      // IG reach export: ig_username + ig_name + Reach + Period_start
      const isIGReach = !isReach && !isGaListens && !isGaSiteVisits && !isTikTokVideo && !isTikTokOverview &&
        preview.includes('ig_username') &&
        preview.includes('ig_name') &&
        preview.includes('Reach') &&
        preview.includes('Period_start');

      // Try to extract month — prefer Period_start in CSV (new FB reach format)
      let autoMonth = '';
      let reachHasPeriodStart = false;

      if (isReach && firstRow['Period_start']) {
        const ps = String(firstRow['Period_start']);
        const m = ps.match(/(\d{4})-(\d{2})/);
        if (m) {
          autoMonth = `${m[1]}-${m[2]}`;
          reachHasPeriodStart = true;
        }
      }

      if (!autoMonth && (isReach || isGaListens || isGaSiteVisits)) {
        const monthMatch = file.name.match(/(\d{4})[_-](\d{2})(?:[_-]|\.|$)/i);
        if (monthMatch) {
          autoMonth = `${monthMatch[1]}-${monthMatch[2]}`;
        }
      }

      let fileType = 'posts';
      if (isReach) fileType = 'reach';
      else if (isGaListens) fileType = 'ga_listens';
      else if (isGaSiteVisits) fileType = 'ga_site_visits';
      else if (isIGReach) fileType = 'ig_reach';
      else if (isTikTokVideo) fileType = 'tiktok_video';
      else if (isTikTokOverview) fileType = 'tiktok_overview';

      // TikTok: extrahera handle ur Videolänk (Video) eller från filnamnsförslag (Översikt).
      // Display-namn fylls i från känt handle-mapping eller filnamn.
      let tiktokHandle = '';
      let tiktokAccountName = '';
      if (isTikTokVideo) {
        const link = firstRow['Videolänk'] || firstRow['Video link'];
        const parsed = link ? parseTikTokVideoUrl(String(link)) : null;
        if (parsed) tiktokHandle = parsed.handle;
        if (tiktokHandle && tiktokAccounts[tiktokHandle]) {
          tiktokAccountName = tiktokAccounts[tiktokHandle];
        } else {
          tiktokAccountName = suggestTikTokAccountName(file.name);
        }
      } else if (isTikTokOverview) {
        // Försök matcha filnamns-förslaget mot ett känt display-namn → fyll i handle
        const suggested = suggestTikTokAccountName(file.name);
        if (suggested) {
          const match = Object.entries(tiktokAccounts).find(
            ([, name]) => name.toLowerCase() === suggested.toLowerCase()
          );
          if (match) {
            tiktokHandle = match[0];
            tiktokAccountName = match[1];
          } else {
            tiktokAccountName = suggested; // visas som förslag; handle måste väljas
          }
        }
      }

      fileEntries.push({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        status: FILE_STATUS.PENDING,
        error: null,
        result: null,
        fileType,
        reachMonth: isReach ? autoMonth : '',
        reachHasPeriodStart: isReach ? reachHasPeriodStart : false,
        gaListensMonth: isGaListens ? autoMonth : '',
        gaSiteVisitsMonth: isGaSiteVisits ? autoMonth : '',
        tiktokHandle,
        tiktokAccountName,
      });
    }

    setFiles(prev => [...prev, ...fileEntries]);
  }, []);

  const handleFileInputChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      addFiles(event.target.files);
      event.target.value = '';
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAll = () => {
    setFiles([]);
    setBatchResult(null);
  };

  const retryFailed = () => {
    setFiles(prev => prev.map(f =>
      f.status === FILE_STATUS.ERROR ? { ...f, status: FILE_STATUS.PENDING, error: null } : f
    ));
    setBatchResult(null);
  };

  const handleProcessFiles = async () => {
    const pendingFiles = files.filter(f =>
      f.status === FILE_STATUS.PENDING || f.status === FILE_STATUS.ERROR
    );
    if (pendingFiles.length === 0) return;

    setIsProcessing(true);
    setBatchResult(null);

    let succeeded = 0;
    let failed = 0;

    for (const entry of pendingFiles) {
      setFiles(prev => prev.map(f =>
        f.id === entry.id ? { ...f, status: FILE_STATUS.PROCESSING } : f
      ));

      try {
        let result;
        if (entry.fileType === 'reach') {
          if (entry.reachHasPeriodStart) {
            result = await api.uploadReachCSV(entry.file);
          } else {
            if (!entry.reachMonth) {
              throw new Error('Ange vilken månad räckviddsfilen gäller.');
            }
            result = await api.uploadReachCSV(entry.file, entry.reachMonth);
          }
        } else if (entry.fileType === 'ga_listens') {
          // Month is mandatory because GA exports contain no date information
          if (!entry.gaListensMonth) {
            throw new Error('Ange vilken månad lyssnarfilen gäller.');
          }
          result = await api.uploadGAListensCSV(entry.file, entry.gaListensMonth);
        } else if (entry.fileType === 'ga_site_visits') {
          if (!entry.gaSiteVisitsMonth) {
            throw new Error('Ange vilken månad sajtbesökfilen gäller.');
          }
          result = await api.uploadGASiteVisitsCSV(entry.file, entry.gaSiteVisitsMonth);
        } else if (entry.fileType === 'ig_reach') {
          result = await api.uploadIGReachCSV(entry.file);
        } else if (entry.fileType === 'tiktok_video') {
          // Video-CSV: handle finns redan i URL:n; vi skickar bara display-namnet så att
          // server-importen kan fylla account_name korrekt.
          result = await api.uploadCSV(entry.file, { tiktokAccountName: entry.tiktokAccountName });
        } else if (entry.fileType === 'tiktok_overview') {
          if (!entry.tiktokHandle) {
            throw new Error('Välj TikTok-konto innan du laddar upp Översikt-filen.');
          }
          result = await api.uploadTikTokOverviewCSV(
            entry.file,
            entry.tiktokHandle,
            entry.tiktokAccountName || entry.tiktokHandle,
          );
        } else {
          result = await api.uploadCSV(entry.file);
        }
        succeeded++;
        setFiles(prev => prev.map(f =>
          f.id === entry.id ? {
            ...f,
            status: FILE_STATUS.SUCCESS,
            result,
            platform: result.import?.platform,
          } : f
        ));
        // När ett nytt TikTok-konto kommer in via Video- eller Översikt-import,
        // uppdatera handle→namn-mappen så att ev. parade Översikt-filer i samma
        // batch får upp kontot i dropdownen.
        if (entry.fileType === 'tiktok_video' && entry.tiktokHandle) {
          setTiktokAccounts(prev => ({
            ...prev,
            [entry.tiktokHandle]: entry.tiktokAccountName || prev[entry.tiktokHandle] || entry.tiktokHandle,
          }));
        } else if (entry.fileType === 'tiktok_overview' && result.account_username) {
          setTiktokAccounts(prev => ({
            ...prev,
            [result.account_username]: result.account_name || prev[result.account_username] || result.account_username,
          }));
        }
      } catch (err) {
        failed++;
        setFiles(prev => prev.map(f =>
          f.id === entry.id ? { ...f, status: FILE_STATUS.ERROR, error: err.message } : f
        ));
      }
    }

    const batchRes = { succeeded, failed, total: pendingFiles.length };
    setBatchResult(batchRes);
    setIsProcessing(false);

    if (succeeded > 0) {
      setTimeout(() => {
        onImportComplete();
      }, 1500);
    }
  };

  const pendingCount = files.filter(f => f.status === FILE_STATUS.PENDING).length;
  const failedCount = files.filter(f => f.status === FILE_STATUS.ERROR).length;
  // Översikt-CSV utan valt konto kan inte laddas upp — blockera knappen.
  const missingTikTokAccount = files.some(f =>
    f.status === FILE_STATUS.PENDING && f.fileType === 'tiktok_overview' && !f.tiktokHandle
  );

  return (
    <div className="space-y-4">
      {batchResult && (
        <Alert className={batchResult.failed === 0 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}>
          <CheckCircle2 className={`h-4 w-4 ${batchResult.failed === 0 ? 'text-green-600' : 'text-yellow-600'}`} />
          <AlertTitle className={batchResult.failed === 0 ? 'text-green-800' : 'text-yellow-800'}>
            Import klar
          </AlertTitle>
          <AlertDescription className={batchResult.failed === 0 ? 'text-green-700' : 'text-yellow-700'}>
            {batchResult.succeeded} av {batchResult.total} filer importerades framgångsrikt.
            {batchResult.failed > 0 && ` ${batchResult.failed} fil(er) misslyckades.`}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xl">Läs in Meta-statistik</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`
              border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
              ${isDragging ? 'border-primary bg-primary/10' : files.length > 0 ? 'border-primary bg-primary/5' : 'border-border'}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileInputChange}
            />
            <div className="flex flex-col items-center space-y-3">
              {files.length > 0 ? (
                <PlusCircle className="w-10 h-10 text-primary" />
              ) : (
                <UploadCloud className="w-10 h-10 text-muted-foreground" />
              )}
              <div className="space-y-1">
                <h3 className="text-base font-semibold">
                  {isDragging
                    ? 'Släpp filerna här'
                    : files.length > 0
                      ? 'Lägg till fler filer'
                      : 'Släpp CSV-filer här eller klicka för att bläddra'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Stöder Facebook- och Instagram-statistik från Meta Business Suite, kontoräckvidd (API) och Google Analytics.
                  Data sparas permanent i databasen.
                </p>
              </div>
            </div>
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">
                  {files.length} fil{files.length !== 1 ? 'er' : ''} valda
                </span>
                <div className="flex space-x-2">
                  {failedCount > 0 && (
                    <Button variant="outline" size="sm" onClick={retryFailed}>
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Försök igen ({failedCount})
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={clearAll} disabled={isProcessing}>
                    Rensa alla
                  </Button>
                </div>
              </div>

              {files.map(entry => (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between p-3 rounded-md border text-sm ${
                    entry.status === FILE_STATUS.SUCCESS ? 'bg-green-50 border-green-200' :
                    entry.status === FILE_STATUS.ERROR ? 'bg-red-50 border-red-200' :
                    entry.status === FILE_STATUS.PROCESSING ? 'bg-blue-50 border-blue-200' :
                    'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                    {entry.status === FILE_STATUS.PROCESSING && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
                    )}
                    {entry.status === FILE_STATUS.SUCCESS && (
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    )}
                    {entry.status === FILE_STATUS.ERROR && (
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                    {entry.status === FILE_STATUS.PENDING && (
                      <FileWarning className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate flex items-center gap-1.5">
                        {entry.file.name}
                        {entry.platform && <PlatformBadge platform={entry.platform} />}
                        {entry.fileType === 'reach' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-300">
                            Kontoräckvidd
                          </span>
                        )}
                        {entry.fileType === 'ga_listens' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-300">
                            Lyssningar (GA)
                          </span>
                        )}
                        {entry.fileType === 'ga_site_visits' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-300">
                            Sajtbesök (GA)
                          </span>
                        )}
                        {entry.fileType === 'ig_reach' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-pink-100 text-pink-800 border border-pink-300">
                            Kontoräckvidd IG (API)
                          </span>
                        )}
                        {entry.fileType === 'tiktok_video' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-black text-white">
                            TikTok video
                          </span>
                        )}
                        {entry.fileType === 'tiktok_overview' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-black text-white">
                            TikTok översikt
                          </span>
                        )}
                      </p>
                      {entry.result && (
                        <p className="text-xs text-green-600">
                          {entry.result.stats?.postsInserted || 0} nya,{' '}
                          {entry.result.stats?.postsUpdated || 0} uppdaterade
                          {entry.result.stats?.attributedViaPermalink > 0 && (
                            <>, {entry.result.stats.attributedViaPermalink} kontonamn återställda via länk</>
                          )}
                        </p>
                      )}
                      {entry.fileType === 'reach' && entry.status === FILE_STATUS.PENDING && entry.reachMonth && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Månad: {entry.reachMonth}{entry.reachHasPeriodStart ? ' (från CSV)' : ''}
                          {!entry.reachHasPeriodStart && (
                            <button
                              type="button"
                              className="ml-2 text-primary hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFiles(prev => prev.map(f =>
                                  f.id === entry.id ? { ...f, reachMonth: '' } : f
                                ));
                              }}
                            >
                              Ändra
                            </button>
                          )}
                        </p>
                      )}
                      {entry.fileType === 'reach' && entry.status === FILE_STATUS.PENDING && !entry.reachMonth && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Månad:</span>
                          <input
                            type="month"
                            value={entry.reachMonth}
                            onChange={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, reachMonth: e.target.value } : f
                              ));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="border border-input rounded px-2 py-0.5 text-xs"
                            required
                          />
                        </div>
                      )}
                      {entry.fileType === 'ga_listens' && entry.status === FILE_STATUS.PENDING && entry.gaListensMonth && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Månad: {entry.gaListensMonth}
                          <button
                            type="button"
                            className="ml-2 text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, gaListensMonth: '' } : f
                              ));
                            }}
                          >
                            Ändra
                          </button>
                        </p>
                      )}
                      {entry.fileType === 'ga_listens' && entry.status === FILE_STATUS.PENDING && !entry.gaListensMonth && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Månad:</span>
                          <input
                            type="month"
                            value={entry.gaListensMonth}
                            onChange={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, gaListensMonth: e.target.value } : f
                              ));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="border border-input rounded px-2 py-0.5 text-xs"
                            required
                          />
                        </div>
                      )}
                      {entry.fileType === 'ga_site_visits' && entry.status === FILE_STATUS.PENDING && entry.gaSiteVisitsMonth && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Månad: {entry.gaSiteVisitsMonth}
                          <button
                            type="button"
                            className="ml-2 text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, gaSiteVisitsMonth: '' } : f
                              ));
                            }}
                          >
                            Ändra
                          </button>
                        </p>
                      )}
                      {entry.fileType === 'ga_site_visits' && entry.status === FILE_STATUS.PENDING && !entry.gaSiteVisitsMonth && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Månad:</span>
                          <input
                            type="month"
                            value={entry.gaSiteVisitsMonth}
                            onChange={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, gaSiteVisitsMonth: e.target.value } : f
                              ));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="border border-input rounded px-2 py-0.5 text-xs"
                            required
                          />
                        </div>
                      )}
                      {entry.fileType === 'tiktok_video' && entry.status === FILE_STATUS.PENDING && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">Konto:</span>
                          <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">@{entry.tiktokHandle || '?'}</span>
                          <span className="text-xs text-muted-foreground">→</span>
                          <input
                            type="text"
                            value={entry.tiktokAccountName}
                            placeholder="Visningsnamn (t.ex. P3 Din Gata)"
                            onChange={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, tiktokAccountName: e.target.value } : f
                              ));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="border border-input rounded px-2 py-0.5 text-xs flex-1 min-w-[160px]"
                          />
                          {tiktokAccounts[entry.tiktokHandle] && (
                            <span className="text-xs text-green-700">✓ känt konto</span>
                          )}
                        </div>
                      )}
                      {entry.fileType === 'tiktok_overview' && entry.status === FILE_STATUS.PENDING && (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">Tillhör konto:</span>
                          <select
                            value={entry.tiktokHandle}
                            onChange={(e) => {
                              e.stopPropagation();
                              const handle = e.target.value;
                              const name = tiktokAccounts[handle] || '';
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, tiktokHandle: handle, tiktokAccountName: name || f.tiktokAccountName } : f
                              ));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={`border rounded px-2 py-0.5 text-xs ${entry.tiktokHandle ? 'border-input' : 'border-red-400 bg-red-50'}`}
                            required
                          >
                            <option value="">— välj konto —</option>
                            {Object.entries(tiktokAccounts).map(([handle, name]) => (
                              <option key={handle} value={handle}>
                                {name} (@{handle})
                              </option>
                            ))}
                          </select>
                          {!entry.tiktokHandle && Object.keys(tiktokAccounts).length === 0 && (
                            <span className="text-xs text-amber-700">
                              Inga TikTok-konton ännu — ladda upp en Video-CSV först.
                            </span>
                          )}
                          {entry.tiktokHandle && (
                            <span className="text-xs text-muted-foreground">
                              → {entry.tiktokAccountName}
                            </span>
                          )}
                        </div>
                      )}
                      {entry.error && (
                        <p className="text-xs text-red-600">{entry.error}</p>
                      )}
                    </div>
                  </div>
                  {entry.status !== FILE_STATUS.PROCESSING && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-shrink-0 h-6 w-6 p-0"
                      onClick={() => removeFile(entry.id)}
                      disabled={isProcessing}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end space-x-2">
            {onCancel && (
              <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
                Avbryt
              </Button>
            )}
            <Button
              onClick={handleProcessFiles}
              disabled={pendingCount === 0 || isProcessing || missingTikTokAccount}
              className="min-w-[120px]"
              title={missingTikTokAccount ? 'Välj konto för alla TikTok-Översikt-filer först.' : undefined}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importerar...
                </>
              ) : (
                `Importera ${pendingCount > 0 ? pendingCount + ' fil' + (pendingCount !== 1 ? 'er' : '') : ''}`
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
