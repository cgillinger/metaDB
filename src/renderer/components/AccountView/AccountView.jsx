/**
 * AccountView — per-account statistics table.
 * Supports both Meta post metrics (standard mode) and a GA listens pivot
 * table (gaListensMode), showing programme × month listening counts.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PlatformBadge from '../ui/PlatformBadge';
import InfoTooltip from '../ui/InfoTooltip';
import CollabBadge from '../ui/CollabBadge';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Calculator, ExternalLink, Copy, Check, Trash2, AlertCircle, Users } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
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
import GroupCreateDialog from '../AccountGroups/GroupCreateDialog';

// P4 Lokalt regional channel names, kept as an explicit Set for O(1) membership
// lookup. Explicit enumeration is intentional — the list is stable and finite.
const P4_CHANNELS = new Set([
  'P4 Blekinge', 'P4 Dalarna', 'P4 Fyrbodal', 'P4 Göteborg',
  'P4 Gävleborg', 'P4 Gotland', 'P4 Halland', 'P4 Jämtland',
  'P4 Jönköping', 'P4 Kalmar', 'P4 Kristianstad', 'P4 Kronoberg',
  'P4 Malmöhus', 'P4 Norrbotten', 'P4 Sjuhärad', 'P4 Skaraborg',
  'P4 Stockholm', 'P4 Sörmland', 'P4 Uppland', 'P4 Värmland',
  'P4 Västerbotten', 'P4 Västernorrland', 'P4 Västmanland',
  'P4 Väst', 'P4 Östergötland',
]);

/**
 * Sort comparator for GA programme lists.
 * P4 Lokalt channels (group 0) sort before all other programmes (group 1),
 * with Swedish locale-aware alphabetical order applied within each group.
 */
const sortGAPrograms = (a, b) => {
  const ga = P4_CHANNELS.has(a) ? 0 : 1;
  const gb = P4_CHANNELS.has(b) ? 0 : 1;
  if (ga !== gb) return ga - gb;
  return a.localeCompare(b, 'sv');
};

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

// Fields that cannot be meaningfully summed across accounts in a group
const GROUP_NON_SUMMABLE = new Set(['reach', 'average_reach', 'account_reach', 'posts_per_day']);

// Fields that CAN be summed
const GROUP_SUMMABLE = new Set([
  'views', 'likes', 'comments', 'shares', 'saves', 'follows',
  'total_clicks', 'link_clicks', 'other_clicks', 'interactions', 'engagement', 'post_count',
]);

const AccountView = ({
  selectedFields,
  platform,
  periodParams = {},
  gaListensMode = false,
  accountGroups = [],
  onGroupsChanged = null,
}) => {
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
  const [showDeleteColumn, setShowDeleteColumn] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // GA Listens state
  const [gaViewMode, setGaViewMode] = useState('summary'); // 'summary' | 'monthly'
  const [gaSummary, setGaSummary] = useState({ programmes: [], grandTotal: 0 });
  const [gaSortDir, setGaSortDir] = useState('desc');
  const [gaLoading, setGaLoading] = useState(false);
  // Monthly pivot state
  const [gaData, setGaData] = useState([]);
  const [gaMonths, setGaMonths] = useState([]);
  const [gaMonthlySortConfig, setGaMonthlySortConfig] = useState({ key: null, direction: 'desc' });

  // GA batch delete state
  const [gaSelectedAccounts, setGaSelectedAccounts] = useState(new Set());
  const [gaShowDeleteColumn, setGaShowDeleteColumn] = useState(false);
  const [gaDeleteLoading, setGaDeleteLoading] = useState(false);

  // Group create dialog state
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogAccounts, setGroupDialogAccounts] = useState([]);

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
  }, [selectedFields, platform, periodParams, showReachOnlyAccounts, refreshCounter]);

  // Fetch summerade GA-lyssningar
  useEffect(() => {
    if (!gaListensMode) return;
    const fetchGASummary = async () => {
      setGaLoading(true);
      try {
        const months = periodParams.months
          ? periodParams.months.split(',').map(m => m.trim())
          : null;
        const result = await api.getGAListensSummary(months, gaSortDir);
        setGaSummary(result);
      } catch (err) {
        console.error('Fel vid hämtning av GA-lyssningar:', err);
      } finally {
        setGaLoading(false);
      }
    };
    fetchGASummary();
  }, [gaListensMode, periodParams, gaSortDir, refreshCounter]);

  // Fetch GA listens per-month data (for monthly pivot view)
  useEffect(() => {
    if (!gaListensMode || gaViewMode !== 'monthly') return;
    const fetchGAMonthly = async () => {
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
        if (sortedMonths.length > 0 && !gaMonthlySortConfig.key) {
          setGaMonthlySortConfig({ key: sortedMonths[sortedMonths.length - 1], direction: 'desc' });
        }
      } catch (err) {
        console.error('Fel vid hämtning av GA-lyssningar:', err);
      } finally {
        setGaLoading(false);
      }
    };
    fetchGAMonthly();
  }, [gaListensMode, gaViewMode, periodParams, refreshCounter]);

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

  // GA monthly pivot memos
  const gaPivot = useMemo(() => {
    const map = {};
    for (const row of gaData) {
      if (!map[row.account_name]) map[row.account_name] = {};
      map[row.account_name][row.month] = row.listens;
    }
    return map;
  }, [gaData]);

  const gaTotals = useMemo(() => {
    const totals = {};
    for (const monthMap of Object.values(gaPivot)) {
      for (const [month, val] of Object.entries(monthMap)) {
        totals[month] = (totals[month] || 0) + val;
      }
    }
    return totals;
  }, [gaPivot]);

  const gaSortedPrograms = useMemo(() => {
    const programs = Object.keys(gaPivot);
    if (!gaMonthlySortConfig.key) return [...programs].sort(sortGAPrograms);
    return [...programs].sort((a, b) => {
      const aVal = gaPivot[a][gaMonthlySortConfig.key] ?? -1;
      const bVal = gaPivot[b][gaMonthlySortConfig.key] ?? -1;
      return gaMonthlySortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [gaPivot, gaMonthlySortConfig]);

  // Synthetic group rows for GA summary mode
  const gaSummaryWithGroups = useMemo(() => {
    if (!gaSummary?.programmes) return { programmes: [], grandTotal: 0 };
    const gaGroups = accountGroups.filter(g => g.source === 'ga_listens');
    if (gaGroups.length === 0) return gaSummary;

    const progMap = {};
    for (const p of gaSummary.programmes) progMap[p.account_name] = p;

    const syntheticRows = [...gaGroups]
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
      .map(group => {
        const memberNames = group.members.map(k => k.split('::')[0]);
        const memberRows = memberNames.map(n => progMap[n]).filter(Boolean);
        const totalListens = memberRows.reduce((sum, p) => sum + p.total_listens, 0);
        const maxMonthCount = memberRows.length > 0 ? Math.max(...memberRows.map(p => p.month_count)) : 0;
        return {
          account_name: group.name,
          total_listens: totalListens,
          month_count: maxMonthCount,
          _isGroup: true,
          groupId: group.id,
          memberCount: memberNames.length,
          matchedCount: memberRows.length,
        };
      });

    return {
      programmes: [...syntheticRows, ...gaSummary.programmes],
      grandTotal: gaSummary.grandTotal,
    };
  }, [gaSummary, accountGroups]);

  // Synthetic group rows for GA monthly mode
  const gaSortedProgramsWithGroups = useMemo(() => {
    const gaGroups = accountGroups.filter(g => g.source === 'ga_listens');
    if (gaGroups.length === 0) return gaSortedPrograms;

    const syntheticGroupNames = [...gaGroups]
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
      .map(group => `__group__${group.id}`);

    return [...syntheticGroupNames, ...gaSortedPrograms];
  }, [gaSortedPrograms, accountGroups]);

  // Build a map of groupId → aggregated monthly pivot for GA monthly mode
  const gaGroupPivots = useMemo(() => {
    const gaGroups = accountGroups.filter(g => g.source === 'ga_listens');
    if (gaGroups.length === 0) return {};
    const result = {};
    for (const group of gaGroups) {
      const memberNames = group.members.map(k => k.split('::')[0]);
      const agg = {};
      for (const name of memberNames) {
        const memberData = gaPivot[name];
        if (!memberData) continue;
        for (const [month, val] of Object.entries(memberData)) {
          agg[month] = (agg[month] || 0) + val;
        }
      }
      result[`__group__${group.id}`] = { pivot: agg, group };
    }
    return result;
  }, [accountGroups, gaPivot]);

  // Synthetic group rows for posts mode
  const accountDataWithGroups = useMemo(() => {
    const postGroups = accountGroups.filter(g => g.source === 'posts');
    if (postGroups.length === 0) return accountData;

    const accountMap = {};
    for (const a of accountData) {
      accountMap[`${a.account_name}::${a.platform}`] = a;
    }

    const syntheticRows = postGroups.map(group => {
      const memberRows = group.members.map(k => accountMap[k]).filter(Boolean);
      const matchedCount = memberRows.length;
      const row = {
        account_name: group.name,
        platform: 'group',
        _isGroup: true,
        groupId: group.id,
        memberCount: group.members.length,
        matchedCount,
        is_collab: false,
      };
      // Sum summable fields
      for (const field of GROUP_SUMMABLE) {
        row[field] = memberRows.reduce((sum, a) => sum + (a[field] || 0), 0);
      }
      // Map average_reach → reach for display purposes
      row.reach = null;
      return row;
    });

    return [...syntheticRows, ...accountData];
  }, [accountData, accountGroups]);

  // Client-side sorting and pagination — groups always stay at top
  const paginatedData = useMemo(() => {
    const groupRows = [...accountDataWithGroups.filter(a => a._isGroup)]
      .sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv'));
    const individualRows = accountDataWithGroups.filter(a => !a._isGroup);
    let sorted = [...individualRows];

    if (sortConfig.key) {
      sorted.sort((a, b) => {
        let aVal, bVal;

        if (sortConfig.key.startsWith('reach_')) {
          const month = sortConfig.key.replace('reach_', '');
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
    } else {
      sorted.sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv'));
    }

    const startIndex = (currentPage - 1) * pageSize;
    const paginatedIndividuals = sorted.slice(startIndex, startIndex + pageSize);
    return [...groupRows, ...paginatedIndividuals];
  }, [accountDataWithGroups, sortConfig, currentPage, pageSize, reachByAccount]);

  const totalPages = Math.ceil(accountData.length / pageSize);

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
      // Exclude group rows — they are display-only aggregations
      const exportData = formatDataForExport(accountData.filter(a => !a._isGroup));
      await downloadExcel(exportData, 'meta-statistik-konton.xlsx');
    } catch (error) {
      console.error('Export till Excel misslyckades:', error);
    }
  };

  const handleExportToCSV = () => {
    try {
      // Exclude group rows — they are display-only aggregations
      const exportData = formatDataForExport(accountData.filter(a => !a._isGroup));
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

  const handleDeleteAccount = async () => {
    if (!deleteConfirm) return;
    setDeleteLoading(true);
    try {
      await api.deleteAccountPosts(
        deleteConfirm.accountName,
        deleteConfirm.platform,
        periodParams
      );
      setDeleteConfirm(null);
      setRefreshCounter(c => c + 1);
    } catch (err) {
      console.error('Radering misslyckades:', err);
      alert(`Radering misslyckades: ${err.message}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteGAAccount = async () => {
    if (!deleteConfirm) return;
    setDeleteLoading(true);
    try {
      const monthsArray = periodParams.months
        ? periodParams.months.split(',').map(m => m.trim()).filter(Boolean)
        : [];
      await api.deleteGAListensAccount(deleteConfirm.accountName, monthsArray);
      setDeleteConfirm(null);
      setRefreshCounter(c => c + 1);
    } catch (err) {
      console.error('Radering misslyckades:', err);
      alert(`Radering misslyckades: ${err.message}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  /** Clear checkbox selection when summary data reloads (e.g. after deletion). */
  useEffect(() => {
    setGaSelectedAccounts(new Set());
  }, [gaSummary]);

  /** Clear selection when delete column is hidden. */
  useEffect(() => {
    if (!gaShowDeleteColumn) setGaSelectedAccounts(new Set());
  }, [gaShowDeleteColumn]);

  // Early-return GA block — placed after all hooks to satisfy React rules of hooks.
  if (gaListensMode) {
    if (gaLoading) {
      return (
        <Card className="p-6">
          <p className="text-center text-muted-foreground">Laddar lyssningsdata...</p>
        </Card>
      );
    }

    const noData = gaViewMode === 'summary'
      ? gaSummary.programmes.length === 0
      : gaData.length === 0;

    if (noData) {
      return (
        <Card className="p-6">
          <div className="flex justify-center mb-4">
            <div className="inline-flex rounded-md border">
              <Button variant={gaViewMode === 'summary' ? 'default' : 'ghost'} size="sm" onClick={() => setGaViewMode('summary')}>Summerat</Button>
              <Button variant={gaViewMode === 'monthly' ? 'default' : 'ghost'} size="sm" onClick={() => setGaViewMode('monthly')}>Per m&aring;nad</Button>
            </div>
          </div>
          <p className="text-center text-muted-foreground">Ingen GA-lyssningsdata tillg&auml;nglig f&ouml;r vald period</p>
        </Card>
      );
    }

    // --- Export helpers (adapt to current view mode) ---
    const handleGAExportCSV = () => {
      if (gaViewMode === 'summary') {
        const headers = ['#', 'Programnamn', 'Lyssningar'];
        const rows = gaSummary.programmes.map((prog, idx) => [idx + 1, prog.account_name, prog.total_listens]);
        const csvContent = [headers.join(','), ...rows.map(r => r.map(v => {
          const s = String(v);
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(','))].join('\n');
        downloadFile(csvContent, 'ga-lyssningar.csv', 'text/csv;charset=utf-8;');
      } else {
        const formatMonth = (month) => { const [y, m] = month.split('-'); return `${MONTH_NAMES_SV[parseInt(m, 10) - 1]} ${y.slice(2)}`; };
        const headers = ['Programnamn', ...gaMonths.map(formatMonth)];
        const rows = gaSortedPrograms.map(prog => [prog, ...gaMonths.map(m => gaPivot[prog][m] ?? '')]);
        const csvContent = [headers.join(','), ...rows.map(r => r.map(v => {
          const s = String(v);
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(','))].join('\n');
        downloadFile(csvContent, 'ga-lyssningar-per-manad.csv', 'text/csv;charset=utf-8;');
      }
    };

    const handleGAExportExcel = async () => {
      if (gaViewMode === 'summary') {
        const exportData = gaSummary.programmes.map((prog, idx) => ({
          '#': idx + 1, 'Programnamn': prog.account_name, 'Lyssningar': prog.total_listens,
        }));
        await downloadExcel(exportData, 'ga-lyssningar.xlsx');
      } else {
        const formatMonth = (month) => { const [y, m] = month.split('-'); return `${MONTH_NAMES_SV[parseInt(m, 10) - 1]} ${y.slice(2)}`; };
        const exportData = gaSortedPrograms.map(prog => {
          const row = { 'Programnamn': prog };
          for (const m of gaMonths) { row[formatMonth(m)] = gaPivot[prog][m] ?? ''; }
          return row;
        });
        await downloadExcel(exportData, 'ga-lyssningar-per-manad.xlsx');
      }
    };

    /** Toggle a single account in the checkbox selection. */
    const handleGAToggleAccount = (accountName) => {
      setGaSelectedAccounts(prev => {
        const next = new Set(prev);
        if (next.has(accountName)) next.delete(accountName);
        else next.add(accountName);
        return next;
      });
    };

    /** Toggle all / none. */
    const handleGAToggleAll = () => {
      const allNames = gaSummary.programmes.map(p => p.account_name);
      if (gaSelectedAccounts.size === allNames.length) {
        setGaSelectedAccounts(new Set());
      } else {
        setGaSelectedAccounts(new Set(allNames));
      }
    };

    /** Batch-delete selected accounts with confirmation. */
    const handleGABatchDelete = async () => {
      if (gaSelectedAccounts.size === 0) return;
      const names = [...gaSelectedAccounts];
      const confirmed = confirm(
        `Radera all lyssningsdata (alla månader) för ${names.length} konto${names.length > 1 ? 'n' : ''}?\n\n` +
        names.slice(0, 10).join('\n') +
        (names.length > 10 ? `\n... och ${names.length - 10} till` : '') +
        '\n\nDetta kan inte ångras.'
      );
      if (!confirmed) return;

      setGaDeleteLoading(true);
      try {
        await api.deleteGAListensAccounts(names);
        setGaSelectedAccounts(new Set());
        const months = periodParams.months
          ? periodParams.months.split(',').map(m => m.trim())
          : null;
        const result = await api.getGAListensSummary(months, gaSortDir);
        setGaSummary(result);
      } catch (err) {
        console.error('Batch-radering misslyckades:', err);
        alert(`Radering misslyckades: ${err.message}`);
      } finally {
        setGaDeleteLoading(false);
      }
    };

    // --- Shared GA toolbar ---
    const gaToolbar = (
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="inline-flex rounded-md border">
            <Button variant={gaViewMode === 'summary' ? 'default' : 'ghost'} size="sm"
              onClick={() => setGaViewMode('summary')}>Summerat</Button>
            <Button variant={gaViewMode === 'monthly' ? 'default' : 'ghost'} size="sm"
              onClick={() => setGaViewMode('monthly')}>Per m&aring;nad</Button>
          </div>
          {/* Delete toggle — only in summary view */}
          {gaViewMode === 'summary' && (
            <div className="flex items-center gap-2">
              <Switch
                id="ga-show-delete"
                checked={gaShowDeleteColumn}
                onCheckedChange={setGaShowDeleteColumn}
              />
              <Label htmlFor="ga-show-delete" className="text-sm text-red-600">
                Radera konton
              </Label>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Batch delete button — visible when checkboxes are checked */}
          {gaShowDeleteColumn && gaSelectedAccounts.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleGABatchDelete}
              disabled={gaDeleteLoading}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Radera {gaSelectedAccounts.size} konto{gaSelectedAccounts.size > 1 ? 'n' : ''}
            </Button>
          )}
          <Button variant="outline" onClick={handleGAExportCSV}>
            <FileDown className="w-4 h-4 mr-2" />CSV
          </Button>
          <Button variant="outline" onClick={handleGAExportExcel}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
          </Button>
        </div>
      </div>
    );

    // --- Summary view ---
    if (gaViewMode === 'summary') {
      return (
        <Card className="p-4">
          {deleteConfirm?.type === 'ga_listens' && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Bekräfta radering</AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  Radera alla lyssningar för <strong>{deleteConfirm.accountName}</strong> i vald period
                  ({deleteConfirm.listenCount.toLocaleString('sv-SE')} lyssningar totalt)? Detta kan inte ångras.
                </p>
                <div className="flex space-x-2 mt-2">
                  <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)} disabled={deleteLoading}>
                    Avbryt
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleDeleteGAAccount} disabled={deleteLoading}>
                    {deleteLoading ? 'Raderar...' : 'Ja, radera'}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          {gaToolbar}
          <div className="rounded-md border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  {gaShowDeleteColumn && (
                    <TableHead className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={gaSelectedAccounts.size === gaSummary.programmes.length && gaSummary.programmes.length > 0}
                        onChange={handleGAToggleAll}
                        className="rounded border-gray-300"
                        title="Markera alla"
                      />
                    </TableHead>
                  )}
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>Programnamn</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setGaSortDir(prev => prev === 'asc' ? 'desc' : 'asc')}
                  >
                    <div className="flex items-center justify-end whitespace-nowrap">
                      Lyssningar
                      {gaSortDir === 'asc'
                        ? <ArrowUp className="h-4 w-4 ml-1" />
                        : <ArrowDown className="h-4 w-4 ml-1" />}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-primary/5 border-b-2 border-primary/20">
                  {gaShowDeleteColumn && <TableCell />}
                  <TableCell />
                  <TableCell className="font-semibold flex items-center">
                    <Calculator className="w-4 h-4 mr-2 text-primary" />
                    <span className="text-primary">Totalt</span>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-primary">
                    {formatValue(gaSummary.grandTotal)}
                  </TableCell>
                </TableRow>
                {gaSummaryWithGroups.programmes.map((prog, idx) => {
                  const prevIsGroup = idx > 0 && gaSummaryWithGroups.programmes[idx - 1]._isGroup;
                  const showDivider = !prog._isGroup && idx > 0 && prevIsGroup;
                  return (
                    <React.Fragment key={prog._isGroup ? `group-${prog.groupId}` : prog.account_name}>
                      {showDivider && (
                        <TableRow>
                          <TableCell colSpan={gaShowDeleteColumn ? 4 : 3} className="p-0">
                            <hr className="border-border" />
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className={prog._isGroup ? 'bg-blue-50/60 hover:bg-blue-50' : ''}>
                        {gaShowDeleteColumn && (
                          <TableCell className="text-center">
                            {!prog._isGroup && (
                              <input
                                type="checkbox"
                                checked={gaSelectedAccounts.has(prog.account_name)}
                                onChange={() => handleGAToggleAccount(prog.account_name)}
                                className="rounded border-gray-300"
                              />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-center font-medium">
                          {prog._isGroup ? '' : idx + 1 - gaSummaryWithGroups.programmes.filter((p, i) => i < idx && p._isGroup).length}
                        </TableCell>
                        <TableCell className="font-medium">
                          {prog._isGroup ? (
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-blue-600 shrink-0" />
                              <div>
                                <div className="font-semibold">{prog.account_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {prog.matchedCount === prog.memberCount
                                    ? `${prog.memberCount} konton`
                                    : `${prog.matchedCount} av ${prog.memberCount} konton i aktuell data`}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <ProfileIcon accountName={prog.account_name} />
                              <span>{prog.account_name}</span>
                              <PlatformBadge platform="ga_listens" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatValue(prog.total_listens)}
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <button
            onClick={() => {
              setGroupDialogAccounts(
                gaSummary.programmes.map(p => ({
                  account_name: p.account_name,
                  platform: 'ga_listens',
                  key: `${p.account_name}::ga_listens`,
                }))
              );
              setGroupDialogOpen(true);
            }}
            className="mt-3 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Users className="w-3.5 h-3.5" />
            Skapa kontogrupp
          </button>
        </Card>
      );
    }

    // --- Monthly pivot view ---
    const formatGAMonthHeader = (month) => {
      const [year, m] = month.split('-');
      return `${MONTH_NAMES_SV[parseInt(m, 10) - 1]} ${year.slice(2)}`;
    };

    const getGASortIcon = (monthKey) => {
      if (gaMonthlySortConfig.key !== monthKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
      return gaMonthlySortConfig.direction === 'asc'
        ? <ArrowUp className="h-4 w-4 ml-1" />
        : <ArrowDown className="h-4 w-4 ml-1" />;
    };

    return (
      <Card className="p-4">
        {deleteConfirm?.type === 'ga_listens' && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Bekräfta radering</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Radera alla lyssningar för <strong>{deleteConfirm.accountName}</strong> i vald period
                ({deleteConfirm.listenCount.toLocaleString('sv-SE')} lyssningar totalt)? Detta kan inte ångras.
              </p>
              <div className="flex space-x-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)} disabled={deleteLoading}>
                  Avbryt
                </Button>
                <Button variant="destructive" size="sm" onClick={handleDeleteGAAccount} disabled={deleteLoading}>
                  {deleteLoading ? 'Raderar...' : 'Ja, radera'}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {gaToolbar}
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
                    onClick={() => setGaMonthlySortConfig(prev => ({
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
                {showDeleteColumn && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
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
                {showDeleteColumn && <TableCell />}
              </TableRow>
              {gaSortedProgramsWithGroups.map((prog, idx) => {
                const isGroupKey = prog.startsWith('__group__');
                const prevIsGroup = idx > 0 && gaSortedProgramsWithGroups[idx - 1].startsWith('__group__');
                const showDivider = !isGroupKey && idx > 0 && prevIsGroup;

                if (isGroupKey) {
                  const { pivot: groupPivotData, group } = gaGroupPivots[prog] || {};
                  if (!group) return null;
                  return (
                    <TableRow key={prog} className="bg-blue-50/60 hover:bg-blue-50">
                      <TableCell className="text-center font-medium"></TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-blue-600 shrink-0" />
                          <span className="font-semibold">{group.name}</span>
                        </div>
                      </TableCell>
                      {gaMonths.map(month => (
                        <TableCell key={month} className="text-right font-medium">
                          {groupPivotData && groupPivotData[month] !== undefined
                            ? formatValue(groupPivotData[month])
                            : <span className="text-muted-foreground">&mdash;</span>}
                        </TableCell>
                      ))}
                      {showDeleteColumn && <TableCell />}
                    </TableRow>
                  );
                }

                return (
                  <React.Fragment key={prog}>
                    {showDivider && (
                      <TableRow>
                        <TableCell colSpan={gaMonths.length + 2 + (showDeleteColumn ? 1 : 0)} className="p-0">
                          <hr className="border-border" />
                        </TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell className="text-center font-medium">
                        {idx + 1 - Object.keys(gaGroupPivots).length}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <ProfileIcon accountName={prog} />
                          <span>{prog}</span>
                          <PlatformBadge platform="ga_listens" />
                        </div>
                      </TableCell>
                      {gaMonths.map(month => (
                        <TableCell key={month} className="text-right">
                          {gaPivot[prog]?.[month] !== undefined
                            ? formatValue(gaPivot[prog][month])
                            : <span className="text-muted-foreground">&mdash;</span>}
                        </TableCell>
                      ))}
                      {showDeleteColumn && (
                        <TableCell className="text-center">
                          <button
                            onClick={() => setDeleteConfirm({
                              accountName: prog,
                              type: 'ga_listens',
                              listenCount: Object.values(gaPivot[prog] || {}).reduce((sum, v) => sum + v, 0),
                            })}
                            className="text-red-500 hover:text-red-700"
                            title="Radera lyssningar för detta program"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  </React.Fragment>
                );
              })}
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
        <div className="flex items-center gap-4">
          {!gaListensMode && (
            <div className="flex items-center gap-2">
              <Switch
                id="show-delete-column"
                checked={showDeleteColumn}
                onCheckedChange={setShowDeleteColumn}
              />
              <Label htmlFor="show-delete-column" className="text-sm text-red-600">
                Visa raderingskolumn
              </Label>
            </div>
          )}
          <div className="flex space-x-2">
            <Button variant="outline" onClick={handleExportToCSV}><FileDown className="w-4 h-4 mr-2" />CSV</Button>
            <Button variant="outline" onClick={handleExportToExcel}><FileSpreadsheet className="w-4 h-4 mr-2" />Excel</Button>
          </div>
        </div>
      </div>
      {deleteConfirm && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Bekräfta radering</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              Radera alla <strong>{deleteConfirm.postCount}</strong> poster för{' '}
              <strong>{deleteConfirm.accountName}</strong> ({deleteConfirm.platform === 'facebook' ? 'Facebook' : 'Instagram'})
              {' '}i vald period? Detta kan inte ångras.
            </p>
            <div className="flex space-x-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleteLoading}
              >
                Avbryt
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Raderar...' : 'Ja, radera'}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
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
              {showDeleteColumn && (
                <TableHead className="w-12 text-center text-red-500">Radera</TableHead>
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
              {showDeleteColumn && <TableCell />}
              <TableCell></TableCell>
            </TableRow>

            {paginatedData.map((account, index) => {
              const isGroup = account._isGroup;
              const groupIndividualsBefore = paginatedData.filter((a, i) => i < index && !a._isGroup).length;
              const prevIsGroup = index > 0 && paginatedData[index - 1]._isGroup;
              const showDivider = !isGroup && index > 0 && prevIsGroup;

              const rowKey = isGroup
                ? `__group__${account.groupId}`
                : `${account.account_name}::${account.platform}`;

              const rowCls = isGroup
                ? 'bg-blue-50/60 hover:bg-blue-50'
                : account._reachOnly
                ? 'bg-gray-50/50 opacity-60'
                : account.is_collab
                ? 'bg-amber-50/50 opacity-75'
                : '';

              return (
                <React.Fragment key={rowKey}>
                  {showDivider && (
                    <TableRow>
                      <TableCell
                        colSpan={
                          2 +
                          selectedFields.filter(f => f !== 'account_reach').length +
                          (selectedFields.includes('account_reach') ? Math.max(reachMonths.length, 1) : 0) +
                          (showDeleteColumn ? 1 : 0) +
                          1
                        }
                        className="p-0"
                      >
                        <hr className="border-border" />
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow className={rowCls}>
                    <TableCell className="text-center font-medium">
                      {isGroup ? '' : (currentPage - 1) * pageSize + groupIndividualsBefore + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {isGroup ? (
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-blue-600 shrink-0" />
                          <div>
                            <div className="font-semibold">{account.account_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {account.matchedCount === account.memberCount
                                ? `${account.memberCount} konton`
                                : `${account.matchedCount} av ${account.memberCount} konton i aktuell data`}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <ProfileIcon accountName={account.account_name} />
                          <span>{account.account_name || 'Unknown'}</span>
                          <PlatformBadge platform={account.platform} />
                          {account.is_collab ? <CollabBadge /> : null}
                        </div>
                      )}
                    </TableCell>
                    {selectedFields.filter(f => f !== 'account_reach').map(field => (
                      <TableCell key={field} className="text-right">
                        {isGroup ? (
                          GROUP_NON_SUMMABLE.has(field) ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex items-center justify-end group">
                              <span>{formatValue(account[field])}</span>
                            </div>
                          )
                        ) : (
                          <div className="flex items-center justify-end group">
                            <span>{renderCellContent(account, field)}</span>
                            {getCellValue(account, field) !== null && (
                              <CopyButton value={getFieldValue(account, field)} field={field} rowId={`${account.account_id}-${field}`} />
                            )}
                          </div>
                        )}
                      </TableCell>
                    ))}
                    {selectedFields.includes('account_reach') && reachMonths.length > 0 && reachMonths.map(month => {
                      if (isGroup) {
                        return (
                          <TableCell key={`reach-${month}`} className="text-right">
                            <span className="text-muted-foreground">—</span>
                          </TableCell>
                        );
                      }
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
                            <span className="text-muted-foreground cursor-help" title="Kontoräckvidd saknas för denna månad">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                    {selectedFields.includes('account_reach') && reachMonths.length === 0 && (
                      <TableCell className="text-right">
                        <span className="text-muted-foreground text-xs">{isGroup ? '—' : 'Saknas'}</span>
                      </TableCell>
                    )}
                    {showDeleteColumn && (
                      <TableCell className="text-center">
                        {!isGroup && !account._reachOnly && (
                          <button
                            onClick={() => setDeleteConfirm({
                              accountName: account.account_name,
                              platform: account.platform,
                              postCount: account.post_count,
                            })}
                            className="inline-flex items-center justify-center text-red-400 hover:text-red-600 transition-colors"
                            title={`Radera ${account.account_name} från vald period`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      {!isGroup && (
                        <button onClick={() => handleExternalLink(account)} className="inline-flex items-center justify-center text-primary hover:text-primary/80" title="Öppna i webbläsare">
                          <ExternalLink className="h-4 w-4" /><span className="sr-only">Öppna konto</span>
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
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
      {accountData.length > 0 && (
        <button
          onClick={() => {
            setGroupDialogAccounts(
              accountData.map(a => ({
                account_name: a.account_name,
                platform: a.platform,
                key: `${a.account_name}::${a.platform}`,
              }))
            );
            setGroupDialogOpen(true);
          }}
          className="mt-3 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <Users className="w-3.5 h-3.5" />
          Skapa kontogrupp
        </button>
      )}

      <GroupCreateDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        source={gaListensMode ? 'ga_listens' : 'posts'}
        availableAccounts={groupDialogAccounts}
        editGroup={null}
        onSave={() => { if (onGroupsChanged) onGroupsChanged(); }}
      />
    </Card>
  );
};

export default AccountView;
