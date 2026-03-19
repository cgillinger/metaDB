import React, { useState, useEffect, useMemo } from 'react';
import PlatformBadge from '../ui/PlatformBadge';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Info } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { getValue, formatValue, formatDate, DISPLAY_NAMES, ENGAGEMENT_INFO } from '@/utils/columnConfig';
import { downloadFile, downloadExcel, openExternalLink } from '@/utils/storageService';

const ALL_ACCOUNTS = 'all_accounts';

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

// Definiera specifika fält för per-inlägg-vyn - håll detta synkat med MainView.jsx
const POST_VIEW_AVAILABLE_FIELDS = {
  'reach': 'Räckvidd',
  'views': 'Visningar',
  'interactions': 'Interaktioner',
  'engagement': 'Engagemang',
  'likes': 'Reaktioner/Gilla',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  // IG-specific
  'saves': 'Sparade',
  'follows': 'Följare',
  // FB-specific
  'total_clicks': 'Totalt antal klick',
  'link_clicks': 'Länkklick',
  'other_clicks': 'Övriga klick',
  'description': 'Beskrivning',
  'publish_time': 'Publiceringstid',
  'account_name': 'Kontonamn',
  'permalink': 'Länk',
  'post_type': 'Typ'
};

// Fält som enbart finns på Facebook
const FB_ONLY_FIELDS = ['total_clicks', 'link_clicks', 'other_clicks'];

// Fält som enbart finns på Instagram
const IG_ONLY_FIELDS = ['saves', 'follows'];

// Max längd för trunkerade beskrivningar
const MAX_DESCRIPTION_LENGTH = 100;

const getDisplayName = (field) => POST_VIEW_AVAILABLE_FIELDS[field] || DISPLAY_NAMES[field] || field;

const getEngagementTooltip = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null;
  const platforms = new Set(data.map(p => p._platform).filter(Boolean));
  if (platforms.size === 1) {
    const p = [...platforms][0];
    return ENGAGEMENT_INFO[p] || null;
  }
  return 'Engagemanget beräknas olika per plattform. FB: inkl. klick. IG: inkl. sparade & följare.';
};

const InfoTooltip = ({ text }) => {
  const [visible, setVisible] = React.useState(false);
  if (!text) return null;
  return (
    <span className="relative inline-flex items-center ml-1">
      <Info
        className="h-3.5 w-3.5 text-gray-400 cursor-help"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      />
      {visible && (
        <span className="absolute left-5 top-0 z-50 w-72 rounded bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
};

// Inläggstyp-badge
const PostTypeBadge = ({ type }) => {
  if (!type) return null;
  const colorMap = {
    'Foton': 'bg-blue-100 text-blue-800',
    'Bilder': 'bg-blue-100 text-blue-800',
    'Länkar': 'bg-purple-100 text-purple-800',
    'Videor': 'bg-red-100 text-red-800',
    'Status': 'bg-green-100 text-green-800',
    'Reels': 'bg-orange-100 text-orange-800',
    'Stories': 'bg-yellow-100 text-yellow-800',
    'default': 'bg-gray-100 text-gray-800'
  };
  const colorClass = colorMap[type] || colorMap.default;
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colorClass}`}>
      {type}
    </span>
  );
};

const PostView = ({ data, selectedFields }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'publish_time', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS);
  const [expandedDescriptions, setExpandedDescriptions] = useState({});

  const engagementTooltip = useMemo(() => getEngagementTooltip(data), [data]);
  const hasMixedData = useMemo(() => {
    if (!Array.isArray(data)) return false;
    const platforms = new Set(data.map(p => p._platform).filter(Boolean));
    return platforms.size > 1;
  }, [data]);

  // Map accountName → platform (sista träff vinner om blandat)
  const uniqueAccounts = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    const map = {};
    for (const post of data) {
      const name = getValue(post, 'account_name');
      if (name) map[name] = post._platform || null;
    }
    return Object.entries(map)
      .map(([name, platform]) => ({ name, platform }))
      .sort((a, b) => a.name.localeCompare(b.name));
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

  const toggleDescription = (postId) => {
    setExpandedDescriptions(prev => ({
      ...prev,
      [postId]: !prev[postId]
    }));
  };

  const formatDescription = (description, postId) => {
    if (!description) return '-';
    const isExpanded = expandedDescriptions[postId];
    if (description.length <= MAX_DESCRIPTION_LENGTH) {
      return <span>{description}</span>;
    }
    return (
      <div>
        {isExpanded ? description : `${description.substring(0, MAX_DESCRIPTION_LENGTH)}...`}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDescription(postId);
          }}
          className="ml-2 text-primary text-sm hover:underline"
        >
          {isExpanded ? 'Visa mindre' : 'Läs mer'}
        </button>
      </div>
    );
  };

  const handleExternalLink = (post) => {
    try {
      const permalink = getValue(post, 'permalink');
      if (permalink) {
        openExternalLink(permalink);
        return;
      }
      // Fallback: bygg URL baserat på plattform
      const platform = post._platform;
      const postId = getValue(post, 'post_id');
      const accountId = getValue(post, 'account_id');
      if (!postId) return;
      let url;
      if (platform === 'instagram') {
        url = `https://www.instagram.com/p/${postId}/`;
      } else if (accountId) {
        url = `https://www.facebook.com/${accountId}/posts/${postId}`;
      } else {
        url = `https://www.facebook.com/${postId}`;
      }
      openExternalLink(url);
    } catch (error) {
      console.error('Failed to open external link:', error);
    }
  };

  // Avgör om ett fält är N/A för ett visst inlägg
  const renderFieldValue = (post, field) => {
    const platform = post._platform;
    if (FB_ONLY_FIELDS.includes(field) && platform === 'instagram') {
      return <span className="text-muted-foreground text-xs">N/A</span>;
    }
    if (IG_ONLY_FIELDS.includes(field) && platform === 'facebook') {
      return <span className="text-muted-foreground text-xs">N/A</span>;
    }
    return formatValue(getValue(post, field));
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
      if (sortConfig.key === 'publish_time') {
        const aDate = new Date(aValue);
        const bDate = new Date(bValue);
        if (!isNaN(aDate) && !isNaN(bDate)) {
          return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
        }
      }
      const aStr = String(aValue || '').toLowerCase();
      const bStr = String(bValue || '').toLowerCase();
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
      const platform = post._platform;
      const row = {
        'Plattform': platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : '',
        'Kontonamn': getValue(post, 'account_name') || '',
        'Beskrivning': getValue(post, 'description') || 'Ingen beskrivning',
        'Publiceringstid': formatDate(getValue(post, 'publish_time')),
        'Typ': getValue(post, 'post_type') || ''
      };
      for (const field of selectedFields) {
        if (['account_name', 'description', 'publish_time', 'post_type'].includes(field)) continue;
        const displayName = getDisplayName(field);
        if (FB_ONLY_FIELDS.includes(field) && platform === 'instagram') {
          row[displayName] = 'N/A';
          continue;
        }
        if (IG_ONLY_FIELDS.includes(field) && platform === 'facebook') {
          row[displayName] = 'N/A';
          continue;
        }
        row[displayName] = formatValue(getValue(post, field));
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
    const accountSuffix = selectedAccount !== ALL_ACCOUNTS
      ? `-${selectedAccount.replace(/\s+/g, '-')}`
      : '';
    downloadFile(csvRows.join('\n'), `meta-statistik-inlagg${accountSuffix}.csv`, 'text/csv;charset=utf-8;');
  };

  const handleExportToExcel = async () => {
    const exportData = formatDataForExport(sortedData);
    if (!exportData.length) return;
    const accountSuffix = selectedAccount !== ALL_ACCOUNTS
      ? `-${selectedAccount.replace(/\s+/g, '-')}`
      : '';
    await downloadExcel(exportData, `meta-statistik-inlagg${accountSuffix}.xlsx`);
  };

  if (selectedFields.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">Välj värden att visa i tabellen ovan</p>
      </Card>
    );
  }

  const showPostType = selectedFields.includes('post_type');

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
              {uniqueAccounts.map(({ name, platform }) => (
                <SelectItem key={name} value={name}>
                  <span className="flex items-center gap-2">
                    {name}
                    <PlatformBadge platform={platform} />
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={handleExportToCSV} aria-label="Exportera till CSV">
            <FileDown className="w-4 h-4 mr-2" />CSV
          </Button>
          <Button variant="outline" onClick={handleExportToExcel} aria-label="Exportera till Excel">
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
                <div className="flex items-center">{getDisplayName('description')} {getSortIcon('description')}</div>
              </TableHead>
              <TableHead className="w-24 whitespace-nowrap cursor-pointer hover:bg-muted/50" onClick={() => handleSort('publish_time')}>
                <div className="flex items-center">{getDisplayName('publish_time')} {getSortIcon('publish_time')}</div>
              </TableHead>
              <TableHead className="w-28 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('account_name')}>
                <div className="flex items-center">{getDisplayName('account_name')} {getSortIcon('account_name')}</div>
              </TableHead>
              {/* Plattformsbadge-kolumn alltid synlig */}
              <TableHead className="w-16 text-center">Plattform</TableHead>
              {/* Inläggstyp om valt */}
              {showPostType && (
                <TableHead className="w-28 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('post_type')}>
                  <div className="flex items-center whitespace-nowrap">Typ {getSortIcon('post_type')}</div>
                </TableHead>
              )}
              {/* Valda statistikfält */}
              {selectedFields.map(field => {
                if (['description', 'publish_time', 'account_name', 'post_type'].includes(field)) return null;
                return (
                  <TableHead key={field} className="w-28 cursor-pointer hover:bg-muted/50" onClick={() => handleSort(field)}>
                    <div className="flex items-center justify-end">
                      {getDisplayName(field)}
                      {field === 'engagement' && <InfoTooltip text={engagementTooltip} />}
                      {getSortIcon(field)}
                    </div>
                  </TableHead>
                );
              })}
              <TableHead className="w-12 text-center">{getDisplayName('permalink')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5 + (showPostType ? 1 : 0) + selectedFields.filter(f => !['description', 'publish_time', 'account_name', 'post_type'].includes(f)).length}
                  className="text-center text-muted-foreground py-8"
                >
                  Ingen data tillgänglig för valda filter
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((post, index) => {
                const postId = getValue(post, 'post_id');
                const description = getValue(post, 'description');
                const publishTime = getValue(post, 'publish_time');
                const accountName = getValue(post, 'account_name');
                const postType = getValue(post, 'post_type');
                const platform = post._platform;

                return (
                  <TableRow key={`post-${postId || index}`}>
                    <TableCell className="text-center font-medium">
                      {(currentPage - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="text-sm text-muted-foreground">
                        {formatDescription(description, postId || index)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(publishTime)}
                    </TableCell>
                    <TableCell>{formatValue(accountName)}</TableCell>
                    <TableCell className="text-center">
                      <PlatformBadge platform={platform} />
                    </TableCell>
                    {showPostType && (
                      <TableCell className="text-center">
                        <PostTypeBadge type={postType} />
                      </TableCell>
                    )}
                    {selectedFields.map(field => {
                      if (['description', 'publish_time', 'account_name', 'post_type'].includes(field)) return null;
                      const showMixedIcon = field === 'engagement' && hasMixedData;
                      const mixedTip = showMixedIcon
                        ? (post._platform === 'facebook' ? ENGAGEMENT_INFO.facebook : ENGAGEMENT_INFO.instagram)
                        : null;
                      return (
                        <TableCell key={field} className="text-right">
                          <span className="inline-flex items-center justify-end gap-1">
                            {renderFieldValue(post, field)}
                            {showMixedIcon && <InfoTooltip text={mixedTip} />}
                          </span>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center">
                      <button
                        onClick={() => handleExternalLink(post)}
                        className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800"
                        title="Öppna i webbläsare"
                      >
                        <ExternalLink className="h-4 w-4" />
                        <span className="sr-only">Öppna inlägg</span>
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
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
              Visar {((currentPage - 1) * pageSize) + 1} till {Math.min(currentPage * pageSize, sortedData?.length || 0)} av {sortedData?.length || 0}
            </span>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Föregående sida</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Nästa sida</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default PostView;
