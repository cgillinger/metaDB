import React, { useState, useEffect, useMemo, useRef } from 'react';
import PlatformBadge from '../ui/PlatformBadge';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, AlertCircle, PieChart as PieChartIcon, Copy, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { formatValue, DISPLAY_NAMES } from '@/utils/columnConfig';
import { api, downloadFile, downloadExcel } from '@/utils/apiClient';

const ALL_ACCOUNTS = 'all_accounts';
const MIN_POSTS_FOR_RELIABLE_STATS = 5;

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

const COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#A4DE6C', '#D0ED57', '#FFC658', '#8DD1E1'
];

const ALL_METRIC_FIELDS = [
  'views', 'reach', 'engagement', 'interactions',
  'likes', 'comments', 'shares',
  'total_clicks', 'link_clicks', 'other_clicks',
  'saves', 'follows'
];

const SimplePieChart = ({ data }) => {
  const sortedData = [...data].sort((a, b) => b.value - a.value);
  const total = sortedData.reduce((sum, item) => sum + item.value, 0);
  let cumulativePercentage = 0;
  return (
    <div className="w-full">
      <div className="relative w-64 h-64 mx-auto">
        <div
          className="w-full h-full rounded-full border border-gray-200 overflow-hidden"
          style={{
            background: `conic-gradient(${sortedData.map((item, index) => {
              const start = cumulativePercentage;
              const percentage = (item.value / total) * 100;
              cumulativePercentage += percentage;
              return `${COLORS[index % COLORS.length]} ${start}% ${cumulativePercentage}%`;
            }).join(', ')})`
          }}
        ></div>
        <div className="absolute top-1/4 left-1/4 w-1/2 h-1/2 rounded-full bg-white"></div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2">
        {sortedData.map((item, index) => (
          <div key={index} className="flex items-center">
            <div className="w-4 h-4 mr-2 flex-shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
            <div className="text-sm truncate">
              <span className="font-medium">{item.name}</span>
              <span className="ml-1 text-gray-500">({(item.percentage).toFixed(1)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const PostTypeView = ({ selectedFields, platform, periodParams = {} }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'post_count', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS);
  const [showOnlyReliable, setShowOnlyReliable] = useState(false);
  const [copyStatus, setCopyStatus] = useState({ field: null, rowId: null, copied: false });

  const [postTypeData, setPostTypeData] = useState([]);
  const [uniqueAccounts, setUniqueAccounts] = useState([]);
  const [loading, setLoading] = useState(false);

  // Detect visible metric fields from selectedFields
  const visibleMetricFields = useMemo(() => {
    if (!selectedFields || !Array.isArray(selectedFields)) return [];
    return selectedFields.filter(field => ALL_METRIC_FIELDS.includes(field));
  }, [selectedFields]);

  // Fetch post type data from API
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = { ...periodParams };
        if (platform) params.platform = platform;
        if (selectedAccount !== ALL_ACCOUNTS) params.account = selectedAccount;
        if (selectedFields && selectedFields.length > 0) params.fields = selectedFields.join(',');

        const data = await api.getPostTypes(params);
        setPostTypeData(data.postTypes || []);
      } catch (error) {
        console.error('Fel vid hämtning av inläggstyper:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [platform, selectedAccount, selectedFields, periodParams]);

  // Fetch unique accounts for filter
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const params = { fields: 'views', ...periodParams };
        if (platform) params.platform = platform;
        const data = await api.getAccounts(params);
        const accounts = (data.accounts || []).map(a => ({
          name: a.account_name,
          platform: a.platform,
        }));
        setUniqueAccounts(accounts);
      } catch (error) {
        console.error('Fel vid hämtning av konton:', error);
      }
    };
    fetchAccounts();
  }, [platform, periodParams]);

  useEffect(() => { setCurrentPage(1); }, [platform, pageSize, selectedAccount, periodParams]);

  // Auto-sort when a new field is added
  const prevFieldsRef = useRef(selectedFields);
  useEffect(() => {
    const prev = prevFieldsRef.current;
    prevFieldsRef.current = selectedFields;
    if (selectedFields && selectedFields.length > (prev ? prev.length : 0)) {
      const newField = selectedFields.find(f => !prev || !prev.includes(f));
      if (newField && ALL_METRIC_FIELDS.includes(newField)) {
        setSortConfig({ key: newField, direction: 'desc' });
      }
    }
  }, [selectedFields]);

  useEffect(() => {
    if (copyStatus.copied) {
      const timer = setTimeout(() => setCopyStatus({ field: null, rowId: null, copied: false }), 1500);
      return () => clearTimeout(timer);
    }
  }, [copyStatus]);

  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleCopyValue = (value, field, rowId) => {
    if (value === undefined || value === null) return;
    let rawValue;
    if (field === 'percentage') rawValue = String(value.toFixed(1));
    else if (typeof value === 'number') rawValue = String(value);
    else rawValue = String(value).replace(/\s+/g, '').replace(/[^\d.,]/g, '');
    navigator.clipboard.writeText(rawValue)
      .then(() => setCopyStatus({ field, rowId, copied: true }))
      .catch(err => console.error('Kunde inte kopiera:', err));
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="h-4 w-4 ml-1" /> : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const getDisplayName = (field) => DISPLAY_NAMES[field] || field;
  const formatPercentage = (value) => value != null ? `${value.toFixed(1)}%` : '-';

  const getPieChartData = () =>
    postTypeData.slice().sort((a, b) => b.post_count - a.post_count).map(item => ({
      name: item.post_type,
      value: item.post_count,
      percentage: item.percentage || 0
    }));

  const CopyButton = ({ value, field, rowId }) => {
    const isCopied = copyStatus.copied && copyStatus.field === field && copyStatus.rowId === rowId;
    if (value === undefined || value === null || value === '' || value === '-') return null;
    return (
      <button onClick={(e) => { e.stopPropagation(); handleCopyValue(value, field, rowId); }}
        className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:text-primary" title="Kopiera till urklipp">
        {isCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </button>
    );
  };

  const filteredData = useMemo(() =>
    postTypeData.filter(item => !showOnlyReliable || item.post_count >= MIN_POSTS_FOR_RELIABLE_STATS),
    [postTypeData, showOnlyReliable]
  );

  const sortedData = useMemo(() => {
    if (!sortConfig.key || !filteredData) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aValue = a[sortConfig.key]; const bValue = b[sortConfig.key];
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1; if (bValue == null) return -1;
      if (typeof aValue === 'number' && typeof bValue === 'number')
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      return sortConfig.direction === 'asc' ? String(aValue).localeCompare(String(bValue)) : String(bValue).localeCompare(String(aValue));
    });
  }, [filteredData, sortConfig]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const formatDataForExport = (data) => {
    if (!data || !Array.isArray(data)) return [];
    return data.map(item => {
      const row = {
        'Inläggstyp': item.post_type,
        'Antal inlägg': item.post_count,
        'Andel': `${(item.percentage || 0).toFixed(1)}%`,
        'Tillförlitlig data': item.post_count >= MIN_POSTS_FOR_RELIABLE_STATS ? 'Ja' : 'Nej'
      };
      for (const field of visibleMetricFields) {
        row[getDisplayName(field)] = formatValue(item[field]);
      }
      return row;
    });
  };

  const handleExportToCSV = () => {
    try {
      const exportData = formatDataForExport(sortedData);
      if (!exportData || exportData.length === 0) return;
      const headers = Object.keys(exportData[0]);
      const csvRows = [headers.join(','), ...exportData.map(row =>
        headers.map(h => { const val = String(row[h] ?? ''); return val.includes(',') ? `"${val}"` : val; }).join(','))];
      downloadFile(csvRows.join('\n'), 'meta-statistik-inlaggstyper.csv', 'text/csv');
    } catch (error) { console.error('Export till CSV misslyckades:', error); }
  };

  const handleExportToExcel = async () => {
    try {
      const exportData = formatDataForExport(sortedData);
      await downloadExcel(exportData, 'meta-statistik-inlaggstyper.xlsx');
    } catch (error) { console.error('Export till Excel misslyckades:', error); }
  };

  return (
    <Card>
      <div className="flex flex-col space-y-4 p-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground">Visa konto:</span>
              <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Välj konto" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ACCOUNTS}>Alla konton</SelectItem>
                  {uniqueAccounts.map(({ name, platform: plat }) => (
                    <SelectItem key={name} value={name}>
                      <span className="flex items-center gap-2">{name} <PlatformBadge platform={plat} /></span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="reliable-stats" checked={showOnlyReliable} onCheckedChange={setShowOnlyReliable} />
              <Label htmlFor="reliable-stats">Visa endast tillförlitlig data (≥{MIN_POSTS_FOR_RELIABLE_STATS} inlägg)</Label>
            </div>
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" onClick={handleExportToCSV}><FileDown className="w-4 h-4 mr-2" />CSV</Button>
            <Button variant="outline" onClick={handleExportToExcel}><FileSpreadsheet className="w-4 h-4 mr-2" />Excel</Button>
          </div>
        </div>

        {postTypeData.length > 0 && (
          <div className="w-full bg-white rounded-lg p-4 border">
            <h3 className="text-lg font-semibold mb-2 flex items-center">
              <PieChartIcon className="w-5 h-5 mr-2 text-primary" />
              Fördelning per inläggstyp
              {selectedAccount !== ALL_ACCOUNTS && `: ${selectedAccount}`}
            </h3>
            <SimplePieChart data={getPieChartData()} />
          </div>
        )}

        <div className="rounded-md overflow-x-auto border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('post_type')}>
                  <div className="flex items-center whitespace-nowrap">Inläggstyp {getSortIcon('post_type')}</div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('post_count')}>
                  <div className="flex items-center whitespace-nowrap">Antal {getSortIcon('post_count')}</div>
                </TableHead>
                <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('percentage')}>
                  <div className="flex items-center whitespace-nowrap">Andel {getSortIcon('percentage')}</div>
                </TableHead>
                {visibleMetricFields.map(field => (
                  <TableHead key={field} className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort(field)}>
                    <div className="flex items-center whitespace-nowrap">Genomsnitt: {getDisplayName(field)} {getSortIcon(field)}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3 + visibleMetricFields.length} className="text-center py-6">
                    {loading ? 'Laddar...' : 'Ingen data tillgänglig'}
                  </TableCell>
                </TableRow>
              ) : paginatedData.map((item, index) => (
                <TableRow key={`${item.post_type}-${index}`} className={item.post_count < MIN_POSTS_FOR_RELIABLE_STATS ? 'bg-gray-50' : ''}>
                  <TableCell className="font-medium">
                    <div className="flex items-center">
                      {item.post_type}
                      {item.post_count < MIN_POSTS_FOR_RELIABLE_STATS && (
                        <AlertCircle className="h-4 w-4 ml-2 text-yellow-500" title="Mindre än 5 inlägg" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end group">
                      <span>{item.post_count}</span>
                      <CopyButton value={item.post_count} field="post_count" rowId={`${item.post_type}-${index}`} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end group">
                      <span>{formatPercentage(item.percentage)}</span>
                      <CopyButton value={item.percentage} field="percentage" rowId={`${item.post_type}-${index}`} />
                    </div>
                  </TableCell>
                  {visibleMetricFields.map(field => (
                    <TableCell key={field} className="text-right">
                      <div className="flex items-center justify-end group">
                        <span>{formatValue(item[field])}</span>
                        <CopyButton value={item[field]} field={field} rowId={`${item.post_type}-${index}`} />
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="bg-gray-50 border-t p-4">
            <div className="py-2 text-sm text-muted-foreground flex items-center">
              <AlertCircle className="h-4 w-4 mr-2 text-yellow-500" />
              <span>Inläggstyper med färre än {MIN_POSTS_FOR_RELIABLE_STATS} inlägg markeras med en gul cirkel.</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border-t">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">Visa</span>
              <Select value={pageSize.toString()} onValueChange={size => { setPageSize(Number(size)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-6">
              {sortedData.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  Visar {((currentPage - 1) * pageSize) + 1} till {Math.min(currentPage * pageSize, sortedData.length)} av {sortedData.length}
                </span>
              )}
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
      </div>
    </Card>
  );
};

export default PostTypeView;
