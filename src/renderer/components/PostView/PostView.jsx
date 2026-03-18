import React, { useState, useEffect } from 'react';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { getValue, formatValue, formatDate, DISPLAY_NAMES } from '@/utils/columnConfig';
import { downloadFile, downloadExcel } from '@/utils/storageService';

const ALL_ACCOUNTS = 'all_accounts';

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

const FIELD_DISPLAY_NAMES = {
  reach: 'Räckvidd',
  views: 'Visningar',
  engagement: 'Totalt engagemang',
  interactions: 'Interaktioner',
  likes: 'Gilla / Reaktioner',
  comments: 'Kommentarer',
  shares: 'Delningar',
  saves: 'Sparade',
  follows: 'Följare',
  total_clicks: 'Totalt antal klick',
  link_clicks: 'Länkklick',
  other_clicks: 'Övriga klick',
  description: 'Beskrivning',
  publish_time: 'Publiceringstid',
  account_name: 'Kontonamn',
  permalink: 'Länk',
  post_type: 'Typ'
};

const PLATFORM_LABELS = {
  facebook: 'FB',
  instagram: 'IG'
};

const getDisplayName = (field) => FIELD_DISPLAY_NAMES[field] || DISPLAY_NAMES[field] || field;

const PostView = ({ data, selectedFields }) => {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS);
  const [uniqueAccounts, setUniqueAccounts] = useState([]);

  useEffect(() => {
    if (data && Array.isArray(data)) {
      const accountNamesSet = new Set();
      for (const post of data) {
        const accountName = getValue(post, 'account_name');
        if (accountName) accountNamesSet.add(accountName);
      }
      setUniqueAccounts(Array.from(accountNamesSet).sort());
    }
  }, [data]);

  useEffect(() => {
    setCurrentPage(1);
  }, [data, pageSize, selectedAccount]);

  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortConfig.direction === 'asc'
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const handleExternalLink = (url) => {
    try {
      if (window.electronAPI?.openExternalLink) {
        window.electronAPI.openExternalLink(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      console.error('Failed to open external link:', error);
    }
  };

  const filteredData = React.useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    if (selectedAccount === ALL_ACCOUNTS) return data;
    return data.filter(post => getValue(post, 'account_name') === selectedAccount);
  }, [data, selectedAccount]);

  const sortedData = React.useMemo(() => {
    if (!sortConfig.key || !filteredData) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aValue = getValue(a, sortConfig.key);
      const bValue = getValue(b, sortConfig.key);
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }
      const aStr = String(aValue).toLowerCase();
      const bStr = String(bValue).toLowerCase();
      return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [filteredData, sortConfig]);

  const paginatedData = React.useMemo(() => {
    if (!sortedData) return [];
    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil((sortedData?.length || 0) / pageSize);

  const formatDataForExport = (exportData) => {
    if (!exportData || !Array.isArray(exportData)) return [];
    return exportData.map(post => {
      const row = {
        'Beskrivning': getValue(post, 'description') || 'Ingen beskrivning',
        'Datum': formatDate(getValue(post, 'publish_time')),
        'Kontonamn': getValue(post, 'account_name'),
        'Plattform': getValue(post, '_platform') || ''
      };
      for (const field of selectedFields) {
        row[getDisplayName(field)] = formatValue(getValue(post, field));
      }
      return row;
    });
  };

  const handleExportToCSV = () => {
    const exportData = formatDataForExport(sortedData);
    if (!exportData.length) return;
    const headers = Object.keys(exportData[0]);
    const csvRows = [headers.join(',')];
    exportData.forEach(row => {
      csvRows.push(headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','));
    });
    downloadFile(csvRows.join('\n'), 'meta-statistik-inlagg.csv', 'text/csv');
  };

  const handleExportToExcel = async () => {
    const exportData = formatDataForExport(sortedData);
    if (!exportData.length) return;
    await downloadExcel(exportData, 'meta-statistik-inlagg.xlsx');
  };

  if (selectedFields.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">Välj värden att visa i tabellen ovan</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex justify-between items-center p-4">
        <div className="flex items-center space-x-4">
          <span className="text-sm text-muted-foreground">Visa konto:</span>
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Välj konto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACCOUNTS}>Alla konton</SelectItem>
              {uniqueAccounts.map(account => (
                <SelectItem key={account} value={account}>{account}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={handleExportToCSV}>
            <FileDown className="w-4 h-4 mr-2" />CSV
          </Button>
          <Button variant="outline" onClick={handleExportToExcel}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
          </Button>
        </div>
      </div>

      <div className="rounded-md overflow-x-auto bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="w-1/3 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('description')}>
                <div className="flex items-center">Beskrivning {getSortIcon('description')}</div>
              </TableHead>
              <TableHead className="w-24 whitespace-nowrap cursor-pointer hover:bg-muted/50" onClick={() => handleSort('publish_time')}>
                <div className="flex items-center">Datum {getSortIcon('publish_time')}</div>
              </TableHead>
              <TableHead className="w-28 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('account_name')}>
                <div className="flex items-center">Konto {getSortIcon('account_name')}</div>
              </TableHead>
              <TableHead className="w-12">Plattf.</TableHead>
              {selectedFields.map(field => (
                <TableHead key={field} className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort(field)}>
                  <div className="flex items-center justify-end">
                    {getDisplayName(field)} {getSortIcon(field)}
                  </div>
                </TableHead>
              ))}
              <TableHead className="w-12 text-center">Länk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.map((post, index) => (
              <TableRow key={`post-${index}`}>
                <TableCell className="text-center font-medium">
                  {(currentPage - 1) * pageSize + index + 1}
                </TableCell>
                <TableCell className="max-w-md">
                  <span className="text-sm text-muted-foreground line-clamp-2">
                    {getValue(post, 'description') || 'Ingen beskrivning'}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(getValue(post, 'publish_time'))}
                </TableCell>
                <TableCell>{getValue(post, 'account_name')}</TableCell>
                <TableCell>
                  {post._platform && (
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      post._platform === 'facebook' ? 'bg-blue-100 text-blue-800' : 'bg-pink-100 text-pink-800'
                    }`}>
                      {PLATFORM_LABELS[post._platform] || post._platform}
                    </span>
                  )}
                </TableCell>
                {selectedFields.map(field => (
                  <TableCell key={field} className="text-right">
                    {formatValue(getValue(post, field))}
                  </TableCell>
                ))}
                <TableCell className="text-center">
                  {getValue(post, 'permalink') && (
                    <button
                      onClick={() => handleExternalLink(getValue(post, 'permalink'))}
                      className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800"
                      title="Öppna i webbläsare"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between p-4 border-t">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">Visa</span>
            <Select
              value={pageSize.toString()}
              onValueChange={size => { setPageSize(Number(size)); setCurrentPage(1); }}
            >
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center space-x-6">
            <span className="text-sm text-muted-foreground">
              Visar {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, sortedData?.length || 0)} av {sortedData?.length || 0}
            </span>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default PostView;
