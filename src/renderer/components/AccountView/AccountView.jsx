import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PlatformBadge from '../ui/PlatformBadge';
import InfoTooltip from '../ui/InfoTooltip';
import CollabBadge from '../ui/CollabBadge';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Calculator, ExternalLink, Copy, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import {
  formatValue,
  DISPLAY_NAMES,
  ENGAGEMENT_INFO
} from '@/utils/columnConfig';
import { api, downloadFile, downloadExcel, openExternalLink } from '@/utils/apiClient';

const ACCOUNT_VIEW_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'average_reach': 'Genomsnittlig räckvidd',
  'account_reach': 'Kontoräckvidd (API)',
  'interactions': 'Interaktioner',
  'engagement': 'Engagemang',
  'likes': 'Reaktioner/Gilla',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare',
  'total_clicks': 'Totalt antal klick',
  'link_clicks': 'Länkklick',
  'other_clicks': 'Övriga klick',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

const FB_ONLY_FIELDS = ['total_clicks', 'link_clicks', 'other_clicks'];
const IG_ONLY_FIELDS = ['saves', 'follows'];

const CHANNEL_COLORS = {
  'P1': '#0066cc', 'P2': '#ff6600', 'P3': '#00cc66', 'P4': '#cc33cc',
  'EKOT': '#005eb8', 'RADIOSPORTEN': '#1c5c35', 'SR': '#000000', 'default': '#000000'
};

const ProfileIcon = ({ accountName }) => {
  const name = accountName || 'Okänd';
  const firstLetter = name.charAt(0).toUpperCase();
  let backgroundColor = CHANNEL_COLORS.default;
  let channel = '';
  const nameLower = name.toLowerCase();
  if (nameLower.includes('ekot') || nameLower.includes('radio sweden')) { backgroundColor = CHANNEL_COLORS.EKOT; channel = 'E'; }
  else if (nameLower.includes('radiosporten') || nameLower.includes('radio sporten')) { backgroundColor = CHANNEL_COLORS.RADIOSPORTEN; channel = 'RS'; }
  else if (nameLower.includes('p1')) { backgroundColor = CHANNEL_COLORS.P1; channel = 'P1'; }
  else if (nameLower.includes('p2')) { backgroundColor = CHANNEL_COLORS.P2; channel = 'P2'; }
  else if (nameLower.includes('p3')) { backgroundColor = CHANNEL_COLORS.P3; channel = 'P3'; }
  else if (nameLower.includes('p4')) { backgroundColor = CHANNEL_COLORS.P4; channel = 'P4'; }
  else if (nameLower.includes('sveriges radio')) { backgroundColor = CHANNEL_COLORS.SR; channel = 'SR'; }
  const displayLetter = channel || firstLetter;
  return (
    <div className="flex-shrink-0 w-6 h-6 rounded-sm flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor }}>
      {displayLetter}
    </div>
  );
};

const FIELDS_WITHOUT_TOTALS = ['average_reach', 'posts_per_day'];

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

function formatReachColumnHeader(month) {
  const [year, m] = month.split('-');
  return `Räckvidd ${MONTH_NAMES_SV[parseInt(m, 10) - 1]} ${year.slice(2)}`;
}

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

const AccountView = ({ selectedFields, platform, periodParams = {}, gaListensMode = false }) => {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [copyStatus, setCopyStatus] = useState({ field: null, rowId: null, copied: false });
  const [accountData, setAccountData] = useState([]);
  const [totalSummary, setTotalSummary] = useState({});
  const [reachByAccount, setReachByAccount] = useState({});
  const [reachMonths, setReachMonths] = useState([]);
  const [showReachOnlyAccounts, setShowReachOnlyAccounts] = useState(false);
  const [loading, setLoading] = useState(false);

  // GA Listens state
  const [gaData, setGaData] = useState([]);
  const [gaMonths, setGaMonths] = useState([]);
  const [gaSortConfig, setGaSortConfig] = useState({ key: null, direction: 'desc' });
  const [gaLoading, setGaLoading] = useState(false);

  // Fetch account data from API
  useEffect(() => {
    if (gaListensMode) return;
    if (!selectedFields || selectedFields.length === 0) {
      setAccountData([]);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        const params = {
          fields: selectedFields.join(','),
          ...periodParams,
        };
        if (platform) params.platform = platform;
        if (showReachOnlyAccounts && selectedFields.includes('account_reach')) {
          params.includeReachOnly = 'true';
        }

        const data = await api.getAccounts(params);
        setAccountData(data.accounts || []);
        setTotalSummary(data.totals || {});
        setReachByAccount(data.reachByAccount || {});
        setReachMonths(data.reachMonths || []);
      } catch (error) {
        console.error('Fel vid hämtning av kontodata:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedFields, platform, periodParams, showReachOnlyAccounts]);

  // Fetch GA listens data
  useEffect(() => {
    if (!gaListensMode) return;
    const fetchGAData = async () => {
      setGaLoading(true);
      try {
        const months = periodParams.months
          ? periodParams.months.split(',').map(m => m.trim())
          : null;
        const result = await api.getGAListens(months);
        const rows = result.data || [];
        setGaData(rows);
        const monthsSet = new Set(rows.map(r => r.month));
        const sortedMonths = [...monthsSet].sort();
        setGaMonths(sortedMonths);
        // Default sort: latest month descending
        if (sortedMonths.length > 0) {
          setGaSortConfig({ key: sortedMonths[sortedMonths.length - 1], direction: 'desc' });
        }
      } catch (err) {
        console.error('Fel vid hämtning av GA-lyssningar:', err);
      } finally {
        setGaLoading(false);
      }
    };
    fetchGAData();
  }, [gaListensMode, periodParams]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedFields, platform, pageSize, periodParams]);

  // Auto-sort when a new field is added
  const prevFieldsRef = useRef(selectedFields);
  useEffect(() => {
    const prev = prevFieldsRef.current;
    prevFieldsRef.current = selectedFields;
    if (selectedFields.length > prev.length) {
      const newField = selectedFields.find(f => !prev.includes(f));
      if (newField && newField !== 'account_reach') {
        const sortKey = newField === 'average_reach' ? 'reach' : newField;
        setSortConfig({ key: sortKey, direction: 'desc' });
      }
    }
  }, [selectedFields]);

  useEffect(() => {
    if (copyStatus.copied) {
      const timer = setTimeout(() => setCopyStatus({ field: null, rowId: null, copied: false }), 1500);
      return () => clearTimeout(timer);
    }
  }, [copyStatus]);

  const handleCopyValue = useCallback((value, field, rowId = 'total') => {
    if (value === undefined || value === null) return;
    const rawValue = String(value).replace(/\s+/g, '').replace(/[^\d.,]/g, '');
    navigator.clipboard.writeText(rawValue)
      .then(() => setCopyStatus({ field, rowId, copied: true }))
      .catch(err => console.error('Kunde inte kopiera:', err));
  }, []);

  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleExternalLink = (account) => {
    try {
      const plat = account.platform;
      const username = account.account_username;
      const accountId = account.account_id;
      let url;
      if (plat === 'instagram' && username && username !== '-') {
        url = `https://www.instagram.com/${username}/`;
      } else if (accountId && accountId !== '-') {
        url = `https://www.facebook.com/${accountId}`;
      } else return;
      openExternalLink(url);
    } catch (error) {
      console.error('Failed to open external link:', error);
    }
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="h-4 w-4 ml-1" /> : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const getDisplayName = (field) => ACCOUNT_VIEW_AVAILABLE_FIELDS[field] || DISPLAY_NAMES[field] || field;

  const CopyButton = ({ value, field, rowId = 'total' }) => {
    const isCopied = copyStatus.copied && copyStatus.field === field && copyStatus.rowId === rowId;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleCopyValue(value, field, rowId); }}
        className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:text-primary"
        title="Kopiera till urklipp"
      >
        {isCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </button>
    );
  };

  // Client-side sorting and pagination
  const paginatedData = useMemo(() => {
    let sorted = [...accountData];

    if (sortConfig.key) {
      sorted.sort((a, b) => {
        let aVal, bVal;

        if (sortConfig.key.startsWith('reach_')) {
          const month = sortConfig.key.replace('reach_', '');
          // Account reach is Facebook-only
          aVal = a.platform === 'facebook' ? (reachByAccount[a.account_name]?.[month] ?? -1) : -1;
          bVal = b.platform === 'facebook' ? (reachByAccount[b.account_name]?.[month] ?? -1) : -1;
        } else if (sortConfig.key === 'account_name') {
          aVal = (a.account_name || '').toLowerCase();
          bVal = (b.account_name || '').toLowerCase();
          if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
        } else {
          aVal = a[sortConfig.key];
          bVal = b[sortConfig.key];
        }

        if (aVal == null) aVal = -1;
        if (bVal == null) bVal = -1;

        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    const startIndex = (currentPage - 1) * pageSize;
    return sorted.slice(startIndex, startIndex + pageSize);
  }, [accountData, sortConfig, currentPage, pageSize, reachByAccount]);

  const totalPages = Math.ceil(accountData.length / pageSize);

  // GA pivot: { programnamn → { month → listens } }
  const gaPivot = useMemo(() => {
    const map = {};
    for (const row of gaData) {
      if (!map[row.account_name]) map[row.account_name] = {};
      map[row.account_name][row.month] = row.listens;
    }
    return map;
  }, [gaData]);

  // GA column totals
  const gaTotals = useMemo(() => {
    const totals = {};
    for (const monthMap of Object.values(gaPivot)) {
      for (const [month, val] of Object.entries(monthMap)) {
        totals[month] = (totals[month] || 0) + val;
      }
    }
    return totals;
  }, [gaPivot]);

  // GA sorted program list
  const gaSortedPrograms = useMemo(() => {
    const programs = Object.keys(gaPivot);
    if (!gaSortConfig.key) return programs.sort((a, b) => a.localeCompare(b, 'sv'));
    return [...programs].sort((a, b) => {
      const aVal = gaPivot[a][gaSortConfig.key] ?? -1;
      const bVal = gaPivot[b][gaSortConfig.key] ?? -1;
      return gaSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [gaPivot, gaSortConfig]);

  const getFieldValue = (account, field) => {
    // Map average_reach → reach from API
    if (field === 'average_reach') return account.reach;
    return account[field];
  };

  const renderCellContent = (account, field) => {
    const plat = account.platform;
    if (FB_ONLY_FIELDS.includes(field) && plat === 'instagram') return <span className="text-muted-foreground text-xs">N/A</span>;
    if (IG_ONLY_FIELDS.includes(field) && plat === 'facebook') return <span className="text-muted-foreground text-xs">N/A</span>;
    return formatValue(getFieldValue(account, field));
  };

  const getCellValue = (account, field) => {
    const plat = account.platform;
    if (FB_ONLY_FIELDS.includes(field) && plat === 'instagram') return null;
    if (IG_ONLY_FIELDS.includes(field) && plat === 'facebook') return null;
    return getFieldValue(account, field);
  };

  // GA helpers
  const formatGAMonthHeader = (month) => {
    const [year, m] = month.split('-');
    return `${MONTH_NAMES_SV[parseInt(m, 10) - 1]} ${year.slice(2)}`;
  };

  const getGASortIcon = (monthKey) => {
    if (gaSortConfig.key !== monthKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return gaSortConfig.direction === 'asc'
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const handleGAExportCSV = () => {
    const headers = ['Programnamn', ...gaMonths.map(formatGAMonthHeader)];
    const rows = gaSortedPrograms.map(prog => [
      prog,
      ...gaMonths.map(m => gaPivot[prog][m] ?? ''),
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(v => {
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))].join('\n');
    downloadFile(csvContent, 'ga-lyssningar.csv', 'text/csv;charset=utf-8;');
  };

  const handleGAExportExcel = async () => {
    const exportData = gaSortedPrograms.map(prog => {
      const row = { 'Programnamn': prog };
      for (const m of gaMonths) {
        row[formatGAMonthHeader(m)] = gaPivot[prog][m] ?? '';
      }
      return row;
    });
    await downloadExcel(exportData, 'ga-lyssningar.xlsx');
  };

  // Format data for export
  const formatDataForExport = (exportData) => {
    return exportData.map(account => {
      const plat = account.platform;
      const formatted = {
        'Kontonamn': account.account_name || 'Unknown',
        'Plattform': plat === 'facebook' ? 'Facebook' : plat === 'instagram' ? 'Instagram' : 'Blandad'
      };
      if (plat === 'instagram' && account.account_username && account.account_username !== '-') {
        formatted['Instagram URL'] = `https://www.instagram.com/${account.account_username}/`;
      } else if (account.account_id) {
        formatted['Facebook URL'] = `https://www.facebook.com/${account.account_id}`;
      }
      for (const field of selectedFields) {
        if (field === 'account_reach') continue;
        const displayName = getDisplayName(field);
        if (FB_ONLY_FIELDS.includes(field) && plat === 'instagram') { formatted[displayName] = 'N/A'; continue; }
        if (IG_ONLY_FIELDS.includes(field) && plat === 'facebook') { formatted[displayName] = 'N/A'; continue; }
        formatted[displayName] = formatValue(getFieldValue(account, field));
      }
      if (selectedFields.includes('account_reach')) {
        for (const month of reachMonths) {
          const headerName = formatReachColumnHeader(month);
          // Account reach is Facebook-only — show dash for other platforms
          const reachMap = plat === 'facebook' ? reachByAccount[account.account_name] : undefined;
          formatted[headerName] = reachMap?.[month] !== undefined
            ? formatValue(reachMap[month])
            : '—';
        }
      }
      return formatted;
    });
  };

  const handleExportToExcel = async () => {
    try {
      const exportData = formatDataForExport(accountData);
      await downloadExcel(exportData, 'meta-statistik-konton.xlsx');
    } catch (error) {
      console.error('Export till Excel misslyckades:', error);
    }
  };

  const handleExportToCSV = () => {
    try {
      const exportData = formatDataForExport(accountData);
      if (!exportData || exportData.length === 0) return;
      const headers = Object.keys(exportData[0]);
      const rows = exportData.map(row =>
        headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(',')
      );
      const csvContent = [headers.join(','), ...rows].join('\n');
      downloadFile(csvContent, 'meta-statistik-konton.csv', 'text/csv;charset=utf-8;');
    } catch (error) {
      console.error('Export till CSV misslyckades:', error);
    }
  };

  // ── GA Listens mode ──────────────────────────────────────────────────────
  if (gaListensMode) {
    if (gaLoading) {
      return (
        <Card className="p-6">
          <p className="text-center text-muted-foreground">Laddar lyssningsdata...</p>
        </Card>
      );
    }
    if (gaData.length === 0) {
      return (
        <Card className="p-6">
          <p className="text-center text-muted-foreground">Ingen GA-lyssningsdata tillgänglig för vald period</p>
        </Card>
      );
    }
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div />
          <div className="flex space-x-2">
            <Button variant="outline" onClick={handleGAExportCSV}>
              <FileDown className="w-4 h-4 mr-2" />CSV
            </Button>
            <Button variant="outline" onClick={handleGAExportExcel}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
            </Button>
          </div>
        </div>
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Programnamn</TableHead>
                {gaMonths.map(month => (
                  <TableHead
                    key={month}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setGaSortConfig(prev => ({
                      key: month,
                      direction: prev.key === month && prev.direction === 'asc' ? 'desc' : 'asc',
                    }))}
                  >
                    <div className="flex items-center justify-end whitespace-nowrap">
                      {formatGAMonthHeader(month)}
                      {getGASortIcon(month)}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Totalsumma-rad */}
              <TableRow className="bg-primary/5 border-b-2 border-primary/20">
                <TableCell />
                <TableCell className="font-semibold flex items-center">
                  <Calculator className="w-4 h-4 mr-2 text-primary" />
                  <span className="text-primary">Totalt</span>
                </TableCell>
                {gaMonths.map(month => (
                  <TableCell key={month} className="text-right font-semibold text-primary">
                    {formatValue(gaTotals[month])}
                  </TableCell>
                ))}
              </TableRow>
              {gaSortedPrograms.map((prog, idx) => (
                <TableRow key={prog}>
                  <TableCell className="text-center font-medium">{idx + 1}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <ProfileIcon accountName={prog} />
                      <span>{prog}</span>
                      <PlatformBadge platform="ga_listens" />
                    </div>
                  </TableCell>
                  {gaMonths.map(month => (
                    <TableCell key={month} className="text-right">
                      {gaPivot[prog][month] !== undefined
                        ? formatValue(gaPivot[prog][month])
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    );
  }
  // ── end GA Listens mode ───────────────────────────────────────────────────

  if (selectedFields.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">Välj värden att visa i tabellen ovan</p>
      </Card>
    );
  }

  if (!loading && accountData.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">Ingen data tillgänglig för vald period</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          {selectedFields.includes('account_reach') && (
            <div className="flex items-center gap-2">
              <Switch
                id="show-reach-only"
                checked={showReachOnlyAccounts}
                onCheckedChange={setShowReachOnlyAccounts}
              />
              <Label htmlFor="show-reach-only" className="text-sm">
                Visa konton utan publiceringar (bara räckvidd)
              </Label>
            </div>
          )}
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={handleExportToCSV}><FileDown className="w-4 h-4 mr-2" />CSV</Button>
          <Button variant="outline" onClick={handleExportToExcel}><FileSpreadsheet className="w-4 h-4 mr-2" />Excel</Button>
        </div>
      </div>
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('account_name')}>
                <div className="flex items-center">Kontonamn {getSortIcon('account_name')}</div>
              </TableHead>
              {selectedFields.filter(f => f !== 'account_reach').map(field => (
                <TableHead key={field} className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort(field === 'average_reach' ? 'reach' : field)}>
                  <div className="flex items-center justify-end">
                    {getDisplayName(field)}
                    {field === 'engagement' && <InfoTooltip text="Engagemanget beräknas olika per plattform. FB: inkl. klick. IG: inkl. sparade & följare." />}
                    {getSortIcon(field === 'average_reach' ? 'reach' : field)}
                  </div>
                </TableHead>
              ))}
              {selectedFields.includes('account_reach') && reachMonths.length > 0 && reachMonths.map(month => (
                <TableHead
                  key={`reach-${month}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSortConfig(current => ({
                    key: `reach_${month}`,
                    direction: current.key === `reach_${month}` && current.direction === 'asc' ? 'desc' : 'asc'
                  }))}
                >
                  <div className="flex items-center justify-end whitespace-nowrap">
                    {formatReachColumnHeader(month)}
                    <PlatformBadge platform="facebook" />
                    {getSortIcon(`reach_${month}`)}
                  </div>
                </TableHead>
              ))}
              {selectedFields.includes('account_reach') && reachMonths.length === 0 && (
                <TableHead>
                  <div className="flex items-center justify-end whitespace-nowrap">
                    Kontoräckvidd
                    <PlatformBadge platform="facebook" />
                  </div>
                </TableHead>
              )}
              <TableHead className="w-12 text-center">Länk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Totalsumma-rad */}
            <TableRow className="bg-primary/5 border-b-2 border-primary/20">
              <TableCell></TableCell>
              <TableCell className="font-semibold flex items-center">
                <Calculator className="w-4 h-4 mr-2 text-primary" />
                <span className="text-primary">Totalt</span>
              </TableCell>
              {selectedFields.filter(f => f !== 'account_reach').map(field => (
                <TableCell key={field} className="text-right font-semibold text-primary">
                  {!FIELDS_WITHOUT_TOTALS.includes(field) ? (
                    <div className="flex items-center justify-end group">
                      <span>{formatValue(field === 'average_reach' ? totalSummary.reach : totalSummary[field])}</span>
                      <CopyButton value={field === 'average_reach' ? totalSummary.reach : totalSummary[field]} field={field} rowId="total" />
                    </div>
                  ) : ''}
                </TableCell>
              ))}
              {selectedFields.includes('account_reach') && reachMonths.length > 0 && reachMonths.map(month => (
                <TableCell key={`total-reach-${month}`} className="text-right font-semibold text-primary">
                  —
                </TableCell>
              ))}
              {selectedFields.includes('account_reach') && reachMonths.length === 0 && (
                <TableCell className="text-right font-semibold text-primary">—</TableCell>
              )}
              <TableCell></TableCell>
            </TableRow>

            {paginatedData.map((account, index) => (
              <TableRow
                key={`${account.account_name}::${account.platform}`}
                className={account._reachOnly ? 'bg-gray-50/50 opacity-60' : account.is_collab ? 'bg-amber-50/50 opacity-75' : ''}
              >
                <TableCell className="text-center font-medium">{(currentPage - 1) * pageSize + index + 1}</TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center space-x-2">
                    <ProfileIcon accountName={account.account_name} />
                    <span>{account.account_name || 'Unknown'}</span>
                    <PlatformBadge platform={account.platform} />
                    {account.is_collab ? <CollabBadge /> : null}
                  </div>
                </TableCell>
                {selectedFields.filter(f => f !== 'account_reach').map(field => (
                  <TableCell key={field} className="text-right">
                    <div className="flex items-center justify-end group">
                      <span>{renderCellContent(account, field)}</span>
                      {getCellValue(account, field) !== null && (
                        <CopyButton value={getFieldValue(account, field)} field={field} rowId={`${account.account_id}-${field}`} />
                      )}
                    </div>
                  </TableCell>
                ))}
                {selectedFields.includes('account_reach') && reachMonths.length > 0 && reachMonths.map(month => {
                  const reachMap = account.platform === 'facebook' ? reachByAccount[account.account_name] : undefined;
                  const reachValue = reachMap ? reachMap[month] : undefined;

                  return (
                    <TableCell key={`reach-${month}`} className="text-right">
                      {reachValue !== undefined ? (
                        <div className="flex items-center justify-end group">
                          <span>{formatValue(reachValue)}</span>
                          <CopyButton value={reachValue} field={`reach-${month}`} rowId={`${account.account_id}-reach-${month}`} />
                        </div>
                      ) : (
                        <span
                          className="text-muted-foreground cursor-help"
                          title="Kontoräckvidd saknas för denna månad"
                        >
                          —
                        </span>
                      )}
                    </TableCell>
                  );
                })}
                {selectedFields.includes('account_reach') && reachMonths.length === 0 && (
                  <TableCell className="text-right">
                    <span className="text-muted-foreground text-xs">Saknas</span>
                  </TableCell>
                )}
                <TableCell className="text-center">
                  <button onClick={() => handleExternalLink(account)} className="inline-flex items-center justify-center text-primary hover:text-primary/80" title="Öppna i webbläsare">
                    <ExternalLink className="h-4 w-4" /><span className="sr-only">Öppna konto</span>
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between p-4 border-t">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">Visa</span>
            <Select value={pageSize.toString()} onValueChange={(newSize) => { setPageSize(Number(newSize)); setCurrentPage(1); }}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-6">
            <span className="text-sm text-muted-foreground">
              Visar {((currentPage - 1) * pageSize) + 1} till {Math.min(currentPage * pageSize, accountData.length)} av {accountData.length}
            </span>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" /><span className="sr-only">Föregående</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                <ChevronRight className="h-4 w-4" /><span className="sr-only">Nästa</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default AccountView;
