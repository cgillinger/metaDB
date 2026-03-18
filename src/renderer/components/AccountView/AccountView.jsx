import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Calculator, ExternalLink, Copy, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import {
  getValue,
  formatValue,
  DISPLAY_NAMES
} from '@/utils/columnConfig';
import { downloadFile, downloadExcel, openExternalLink } from '@/utils/storageService';

// Definiera specifika fält för per-konto-vyn - håll detta synkat med MainView.jsx
const ACCOUNT_VIEW_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'average_reach': 'Genomsnittlig räckvidd',
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
  // Common
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

// Fält som enbart finns på Facebook
const FB_ONLY_FIELDS = ['total_clicks', 'link_clicks', 'other_clicks'];

// Fält som enbart finns på Instagram
const IG_ONLY_FIELDS = ['saves', 'follows'];

// Färgkoder för SR-kanaler
const CHANNEL_COLORS = {
  'P1': '#0066cc',
  'P2': '#ff6600',
  'P3': '#00cc66',
  'P4': '#cc33cc',
  'EKOT': '#005eb8',
  'RADIOSPORTEN': '#1c5c35',
  'SR': '#000000',
  'default': '#000000'
};

// ProfileIcon-komponenten
const ProfileIcon = ({ accountName }) => {
  const name = accountName || 'Okänd';
  const firstLetter = name.charAt(0).toUpperCase();

  let backgroundColor = CHANNEL_COLORS.default;
  let channel = '';

  const nameLower = name.toLowerCase();

  if (nameLower.includes('ekot') || nameLower.includes('radio sweden')) {
    backgroundColor = CHANNEL_COLORS.EKOT;
    channel = 'E';
  } else if (nameLower.includes('radiosporten') || nameLower.includes('radio sporten')) {
    backgroundColor = CHANNEL_COLORS.RADIOSPORTEN;
    channel = 'RS';
  } else if (nameLower.includes('p1')) {
    backgroundColor = CHANNEL_COLORS.P1;
    channel = 'P1';
  } else if (nameLower.includes('p2')) {
    backgroundColor = CHANNEL_COLORS.P2;
    channel = 'P2';
  } else if (nameLower.includes('p3')) {
    backgroundColor = CHANNEL_COLORS.P3;
    channel = 'P3';
  } else if (nameLower.includes('p4')) {
    backgroundColor = CHANNEL_COLORS.P4;
    channel = 'P4';
  } else if (nameLower.includes('sveriges radio')) {
    backgroundColor = CHANNEL_COLORS.SR;
    channel = 'SR';
  }

  const displayLetter = channel || firstLetter;

  return (
    <div
      className="flex-shrink-0 w-6 h-6 rounded-sm flex items-center justify-center text-xs font-bold text-white"
      style={{ backgroundColor }}
    >
      {displayLetter}
    </div>
  );
};

// Plattformsbadge
const PlatformBadge = ({ platform }) => {
  if (!platform) return null;
  const isFB = platform === 'facebook';
  return (
    <span
      className={`ml-2 px-1.5 py-0.5 text-xs font-medium rounded ${
        isFB
          ? 'bg-blue-100 text-blue-700'
          : 'bg-pink-100 text-pink-700'
      }`}
    >
      {isFB ? 'FB' : 'IG'}
    </span>
  );
};

// Lista över fält som inte ska ha totalsumma
const FIELDS_WITHOUT_TOTALS = [
  'average_reach',
  'posts_per_day'
];

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

// Funktion för att summera värden per konto (synkron version)
// Stöder blandad FB+IG-data via _platform-fältet
const summarizeByAccount = (data, selectedFields) => {
  if (!Array.isArray(data) || data.length === 0 || !selectedFields) {
    return [];
  }

  // Gruppera per konto-ID
  const groupedByAccount = {};

  for (const post of data) {
    const accountId = getValue(post, 'account_id');
    if (!accountId) continue;

    const accountName = getValue(post, 'account_name') || 'Okänt konto';
    const accountUsername = getValue(post, 'account_username') || '-';
    const platform = post._platform || null;

    if (!groupedByAccount[accountId]) {
      groupedByAccount[accountId] = {
        account_id: accountId,
        account_name: accountName,
        account_username: accountUsername,
        _platform: platform,
        posts: []
      };
    } else {
      // Om kontot har inlägg från flera plattformar, markera som mixed
      if (groupedByAccount[accountId]._platform !== platform) {
        groupedByAccount[accountId]._platform = 'mixed';
      }
    }

    groupedByAccount[accountId].posts.push(post);
  }

  const summaryData = [];

  for (const accountId in groupedByAccount) {
    const account = groupedByAccount[accountId];
    const summary = {
      account_id: account.account_id,
      account_name: account.account_name,
      account_username: account.account_username,
      _platform: account._platform
    };

    // Samla in grundvärden för beräkning av sammansatta fält
    let totalLikes = 0, totalComments = 0, totalShares = 0;
    let totalSaves = 0, totalFollows = 0;
    let totalClicks = 0, totalOtherClicks = 0, totalLinkClicks = 0;

    for (const post of account.posts) {
      totalLikes += (getValue(post, 'likes') || 0);
      totalComments += (getValue(post, 'comments') || 0);
      totalShares += (getValue(post, 'shares') || 0);
      totalSaves += (getValue(post, 'saves') || 0);
      totalFollows += (getValue(post, 'follows') || 0);
      totalClicks += (getValue(post, 'total_clicks') || 0);
      totalOtherClicks += (getValue(post, 'other_clicks') || 0);
      totalLinkClicks += (getValue(post, 'link_clicks') || 0);
    }

    // Spara grundvärden om de är valda
    if (selectedFields.includes('likes')) summary.likes = totalLikes;
    if (selectedFields.includes('comments')) summary.comments = totalComments;
    if (selectedFields.includes('shares')) summary.shares = totalShares;
    if (selectedFields.includes('saves')) summary.saves = totalSaves;
    if (selectedFields.includes('follows')) summary.follows = totalFollows;
    if (selectedFields.includes('total_clicks')) summary.total_clicks = totalClicks;
    if (selectedFields.includes('other_clicks')) summary.other_clicks = totalOtherClicks;
    if (selectedFields.includes('link_clicks')) summary.link_clicks = totalLinkClicks;

    // interactions = likes + comments + shares (alla plattformar)
    if (selectedFields.includes('interactions')) {
      summary.interactions = totalLikes + totalComments + totalShares;
    }

    // engagement:
    //   FB = likes + comments + shares + total_clicks
    //   IG = likes + comments + shares + saves + follows
    //   mixed = likes + comments + shares (gemensam nämnare)
    if (selectedFields.includes('engagement')) {
      const plat = account._platform;
      if (plat === 'facebook') {
        summary.engagement = totalLikes + totalComments + totalShares + totalClicks;
      } else if (plat === 'instagram') {
        summary.engagement = totalLikes + totalComments + totalShares + totalSaves + totalFollows;
      } else {
        // Mixed: beräkna per inlägg och summera
        let engagementSum = 0;
        for (const post of account.posts) {
          engagementSum += (getValue(post, 'engagement') || 0);
        }
        summary.engagement = engagementSum;
      }
    }

    // Antal publiceringar
    if (selectedFields.includes('post_count')) {
      summary.post_count = account.posts.length;
    }

    // Publiceringar per dag
    if (selectedFields.includes('posts_per_day')) {
      if (account.posts.length === 0) {
        summary.posts_per_day = 0;
      } else {
        const dates = [];
        for (const post of account.posts) {
          const publishTime = getValue(post, 'publish_time');
          if (publishTime) {
            const date = new Date(publishTime);
            if (!isNaN(date.getTime())) {
              dates.push(date);
            }
          }
        }

        if (dates.length > 0) {
          const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
          const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
          const daysDiff = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1);
          summary.posts_per_day = Math.round((account.posts.length / daysDiff) * 10) / 10;
        } else {
          summary.posts_per_day = account.posts.length;
        }
      }
    }

    // Beräkna övriga valda fält
    for (const field of selectedFields) {
      if ([
        'likes', 'comments', 'shares', 'saves', 'follows',
        'total_clicks', 'other_clicks', 'link_clicks',
        'interactions', 'engagement',
        'post_count', 'posts_per_day'
      ].includes(field)) {
        continue;
      }

      if (field === 'average_reach') {
        let totalReach = 0;
        for (const post of account.posts) {
          totalReach += (getValue(post, 'reach') || 0);
        }
        summary.average_reach = account.posts.length > 0
          ? Math.round(totalReach / account.posts.length)
          : 0;
      } else {
        let sum = 0;
        for (const post of account.posts) {
          sum += (getValue(post, field) || 0);
        }
        summary[field] = sum;
      }
    }

    summaryData.push(summary);
  }

  return summaryData;
};

const AccountView = ({ data, selectedFields }) => {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [summaryData, setSummaryData] = useState([]);
  const [totalSummary, setTotalSummary] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState({ field: null, rowId: null, copied: false });

  // Avgör om data innehåller blandade plattformar
  const hasMixedPlatforms = React.useMemo(() => {
    if (!Array.isArray(data)) return false;
    const platforms = new Set(data.map(p => p._platform).filter(Boolean));
    return platforms.size > 1;
  }, [data]);

  // Beräkna summerad data när data eller valda fält ändras
  useEffect(() => {
    if (!data || !selectedFields || selectedFields.length === 0) {
      setSummaryData([]);
      setTotalSummary({});
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const summary = summarizeByAccount(data, selectedFields);
      setSummaryData(summary);

      if (Array.isArray(summary) && summary.length > 0) {
        const totals = { account_name: 'Totalt' };

        let totalLikes = 0, totalComments = 0, totalShares = 0;
        let totalSaves = 0, totalFollows = 0;
        let totalClicks = 0, totalOtherClicks = 0, totalLinkClicks = 0;

        if (Array.isArray(data)) {
          data.forEach(post => {
            totalLikes += (getValue(post, 'likes') || 0);
            totalComments += (getValue(post, 'comments') || 0);
            totalShares += (getValue(post, 'shares') || 0);
            totalSaves += (getValue(post, 'saves') || 0);
            totalFollows += (getValue(post, 'follows') || 0);
            totalClicks += (getValue(post, 'total_clicks') || 0);
            totalOtherClicks += (getValue(post, 'other_clicks') || 0);
            totalLinkClicks += (getValue(post, 'link_clicks') || 0);
          });
        }

        if (selectedFields.includes('likes')) totals.likes = totalLikes;
        if (selectedFields.includes('comments')) totals.comments = totalComments;
        if (selectedFields.includes('shares')) totals.shares = totalShares;
        if (selectedFields.includes('saves')) totals.saves = totalSaves;
        if (selectedFields.includes('follows')) totals.follows = totalFollows;
        if (selectedFields.includes('total_clicks')) totals.total_clicks = totalClicks;
        if (selectedFields.includes('other_clicks')) totals.other_clicks = totalOtherClicks;
        if (selectedFields.includes('link_clicks')) totals.link_clicks = totalLinkClicks;

        if (selectedFields.includes('interactions')) {
          totals.interactions = totalLikes + totalComments + totalShares;
        }

        if (selectedFields.includes('engagement')) {
          // För total engagement: summera från alla inlägg via getValue (respekterar _platform)
          let engTotal = 0;
          data.forEach(post => {
            engTotal += (getValue(post, 'engagement') || 0);
          });
          totals.engagement = engTotal;
        }

        if (selectedFields.includes('post_count')) {
          totals.post_count = data.length;
        }

        selectedFields.forEach(field => {
          if ([
            'likes', 'comments', 'shares', 'saves', 'follows',
            'total_clicks', 'other_clicks', 'link_clicks',
            'interactions', 'engagement', 'post_count'
          ].includes(field) || FIELDS_WITHOUT_TOTALS.includes(field)) {
            return;
          }

          if (field === 'views') {
            let totalViews = 0;
            data.forEach(post => {
              totalViews += (getValue(post, field) || 0);
            });
            totals[field] = totalViews;
          } else {
            totals[field] = summary.reduce((sum, account) => {
              return sum + (getValue(account, field) || 0);
            }, 0);
          }
        });

        setTotalSummary(totals);
      }
    } catch (error) {
      console.error('Failed to load summary data:', error);
      setSummaryData([]);
      setTotalSummary({});
    } finally {
      setIsLoading(false);
    }
  }, [data, selectedFields]);

  // Återställ till första sidan när data eller pageSize ändras
  useEffect(() => {
    setCurrentPage(1);
  }, [data, pageSize]);

  // Återställ kopieringsstatus efter 1,5 sekunder
  useEffect(() => {
    if (copyStatus.copied) {
      const timer = setTimeout(() => {
        setCopyStatus({ field: null, rowId: null, copied: false });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [copyStatus]);

  const handleCopyValue = useCallback((value, field, rowId = 'total') => {
    if (value === undefined || value === null) return;
    const rawValue = String(value).replace(/\s+/g, '').replace(/\D/g, '');
    navigator.clipboard.writeText(rawValue)
      .then(() => {
        setCopyStatus({ field, rowId, copied: true });
      })
      .catch(err => {
        console.error('Kunde inte kopiera till urklipp:', err);
      });
  }, []);

  const handleSort = (key) => {
    setSortConfig((currentSort) => ({
      key,
      direction: currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleExternalLink = (account) => {
    try {
      const platform = account._platform;
      const username = getValue(account, 'account_username');
      const accountId = getValue(account, 'account_id');

      let url;
      if (platform === 'instagram' && username && username !== '-') {
        url = `https://www.instagram.com/${username}/`;
      } else if (accountId && accountId !== '-') {
        url = `https://www.facebook.com/${accountId}`;
      } else {
        return;
      }

      openExternalLink(url);
    } catch (error) {
      console.error('Failed to open external link:', error);
    }
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortConfig.direction === 'asc' ?
      <ArrowUp className="h-4 w-4 ml-1" /> :
      <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const getDisplayName = (field) => {
    return ACCOUNT_VIEW_AVAILABLE_FIELDS[field] || DISPLAY_NAMES[field] || field;
  };

  const CopyButton = ({ value, field, rowId = 'total' }) => {
    const isCopied = copyStatus.copied && copyStatus.field === field && copyStatus.rowId === rowId;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleCopyValue(value, field, rowId);
        }}
        className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:text-primary"
        title="Kopiera till urklipp"
      >
        {isCopied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    );
  };

  const sortedData = React.useMemo(() => {
    if (!sortConfig.key || !Array.isArray(summaryData)) return summaryData;

    return [...summaryData].sort((a, b) => {
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
      return sortConfig.direction === 'asc' ?
        aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [summaryData, sortConfig]);

  const paginatedData = React.useMemo(() => {
    if (!sortedData) return [];
    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil((sortedData?.length || 0) / pageSize);

  // Formatera data för export
  const formatDataForExport = (exportData) => {
    return exportData.map(account => {
      const platform = account._platform;
      const formatted = {
        'Kontonamn': getValue(account, 'account_name') || 'Unknown',
        'Plattform': platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'Blandad'
      };

      const username = getValue(account, 'account_username');
      const accountId = getValue(account, 'account_id');
      if (platform === 'instagram' && username && username !== '-') {
        formatted['Instagram URL'] = `https://www.instagram.com/${username}/`;
      } else if (accountId) {
        formatted['Facebook URL'] = `https://www.facebook.com/${accountId}`;
      }

      for (const field of selectedFields) {
        const displayName = getDisplayName(field);
        const value = getValue(account, field);

        // FB-specifika fält för IG-konton visas som N/A
        if (FB_ONLY_FIELDS.includes(field) && platform === 'instagram') {
          formatted[displayName] = 'N/A';
          continue;
        }
        // IG-specifika fält för FB-konton visas som N/A
        if (IG_ONLY_FIELDS.includes(field) && platform === 'facebook') {
          formatted[displayName] = 'N/A';
          continue;
        }

        formatted[displayName] = formatValue(value);
      }

      return formatted;
    });
  };

  const handleExportToExcel = async () => {
    try {
      const exportData = formatDataForExport(sortedData);
      const result = await downloadExcel(exportData, 'meta-statistik-konton.xlsx');
      if (result.success) {
        console.log('Export till Excel lyckades:', result.filePath);
      }
    } catch (error) {
      console.error('Export till Excel misslyckades:', error);
    }
  };

  const handleExportToCSV = () => {
    try {
      const exportData = formatDataForExport(sortedData);
      if (!exportData || exportData.length === 0) return;

      const headers = Object.keys(exportData[0]);
      const rows = exportData.map(row =>
        headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(',')
      );

      const csvContent = [headers.join(','), ...rows].join('\n');
      const result = downloadFile(csvContent, 'meta-statistik-konton.csv', 'text/csv;charset=utf-8;');
      if (result.success) {
        console.log('Export till CSV lyckades:', result.filePath);
      }
    } catch (error) {
      console.error('Export till CSV misslyckades:', error);
    }
  };

  // Avgör om ett fält ska visa N/A för ett visst konto
  const getCellValue = (account, field) => {
    const platform = account._platform;
    if (FB_ONLY_FIELDS.includes(field) && platform === 'instagram') {
      return null; // Renderas som N/A
    }
    if (IG_ONLY_FIELDS.includes(field) && platform === 'facebook') {
      return null; // Renderas som N/A
    }
    return getValue(account, field);
  };

  const renderCellContent = (account, field) => {
    const platform = account._platform;
    if (FB_ONLY_FIELDS.includes(field) && platform === 'instagram') {
      return <span className="text-muted-foreground text-xs">N/A</span>;
    }
    if (IG_ONLY_FIELDS.includes(field) && platform === 'facebook') {
      return <span className="text-muted-foreground text-xs">N/A</span>;
    }
    return formatValue(getValue(account, field));
  };

  // Om inga fält är valda, visa meddelande
  if (selectedFields.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Välj värden att visa i tabellen ovan
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Laddar data...
        </p>
      </Card>
    );
  }

  if (!Array.isArray(sortedData) || sortedData.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Ingen data tillgänglig för vald period
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex justify-end space-x-2 mb-4">
        <Button
          variant="outline"
          onClick={handleExportToCSV}
          aria-label="Exportera till CSV"
        >
          <FileDown className="w-4 h-4 mr-2" />
          CSV
        </Button>
        <Button
          variant="outline"
          onClick={handleExportToExcel}
          aria-label="Exportera till Excel"
        >
          <FileSpreadsheet className="w-4 h-4 mr-2" />
          Excel
        </Button>
      </div>
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('account_name')}
              >
                <div className="flex items-center">
                  Kontonamn {getSortIcon('account_name')}
                </div>
              </TableHead>
              {selectedFields.map(field => (
                <TableHead
                  key={field}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort(field)}
                >
                  <div className="flex items-center justify-end">
                    {getDisplayName(field)} {getSortIcon(field)}
                  </div>
                </TableHead>
              ))}
              <TableHead className="w-12 text-center">
                Länk
              </TableHead>
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
              {selectedFields.map((field) => (
                <TableCell key={field} className="text-right font-semibold text-primary">
                  {!FIELDS_WITHOUT_TOTALS.includes(field) ? (
                    <div className="flex items-center justify-end group">
                      <span>{formatValue(totalSummary[field])}</span>
                      <CopyButton value={totalSummary[field]} field={field} rowId="total" />
                    </div>
                  ) : (
                    ''
                  )}
                </TableCell>
              ))}
              <TableCell></TableCell>
            </TableRow>

            {/* Datarader */}
            {paginatedData.map((account, index) => {
              const accountId = getValue(account, 'account_id');
              const accountName = getValue(account, 'account_name');

              return (
                <TableRow key={`${accountId}-${accountName}`}>
                  <TableCell className="text-center font-medium">
                    {(currentPage - 1) * pageSize + index + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center space-x-2">
                      <ProfileIcon accountName={accountName} />
                      <span>{accountName || 'Unknown'}</span>
                      {hasMixedPlatforms && (
                        <PlatformBadge platform={account._platform} />
                      )}
                    </div>
                  </TableCell>
                  {selectedFields.map((field) => (
                    <TableCell key={field} className="text-right">
                      <div className="flex items-center justify-end group">
                        <span>{renderCellContent(account, field)}</span>
                        {getCellValue(account, field) !== null && (
                          <CopyButton
                            value={getValue(account, field)}
                            field={field}
                            rowId={`${accountId}-${field}`}
                          />
                        )}
                      </div>
                    </TableCell>
                  ))}
                  <TableCell className="text-center">
                    <button
                      onClick={() => handleExternalLink(account)}
                      className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800"
                      title="Öppna i webbläsare"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span className="sr-only">Öppna konto</span>
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between p-4 border-t">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">Visa</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(newSize) => {
                setPageSize(Number(newSize));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-6">
            <span className="text-sm text-muted-foreground">
              Visar {((currentPage - 1) * pageSize) + 1} till {Math.min(currentPage * pageSize, sortedData?.length || 0)} av {sortedData?.length || 0}
            </span>

            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Föregående sida</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
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

export default AccountView;
