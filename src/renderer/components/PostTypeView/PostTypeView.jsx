import React, { useState, useEffect } from 'react';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, AlertCircle, PieChart as PieChartIcon, Copy, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import {
  getValue,
  formatValue,
  DISPLAY_NAMES
} from '@/utils/columnConfig';
import { downloadFile, downloadExcel } from '@/utils/storageService';

// Constants for view
const ALL_ACCOUNTS = 'all_accounts';
const MIN_POSTS_FOR_RELIABLE_STATS = 5;

// Page size options for pagination
const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

// Colors for the pie chart segments
const COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8',
  '#82CA9D', '#A4DE6C', '#D0ED57', '#FFC658', '#8DD1E1'
];

// All metric fields supported by this view
const ALL_METRIC_FIELDS = [
  'views', 'reach', 'engagement', 'interactions',
  'likes', 'comments', 'shares',
  // FB-specific
  'total_clicks', 'link_clicks', 'other_clicks',
  // IG-specific
  'saves', 'follows'
];

// Function to calculate aggregate metrics by post type
const aggregateByPostType = (data, selectedAccount = ALL_ACCOUNTS) => {
  if (!Array.isArray(data) || data.length === 0) return [];

  // Filter by account if specified
  const filteredData = selectedAccount === ALL_ACCOUNTS
    ? data
    : data.filter(post => getValue(post, 'account_name') === selectedAccount);

  if (filteredData.length === 0) return [];

  // Group posts by post type
  const postTypeGroups = {};

  filteredData.forEach(post => {
    const postType = getValue(post, 'post_type') || 'Okänd';

    if (!postTypeGroups[postType]) {
      postTypeGroups[postType] = {
        post_type: postType,
        posts: []
      };
    }

    postTypeGroups[postType].posts.push(post);
  });

  // Calculate metrics for each post type
  const aggregatedData = Object.values(postTypeGroups).map(group => {
    const postCount = group.posts.length;
    const isReliable = postCount >= MIN_POSTS_FOR_RELIABLE_STATS;

    const metrics = {
      post_count: postCount,
      percentage: (postCount / filteredData.length) * 100,
      is_reliable: isReliable
    };

    ALL_METRIC_FIELDS.forEach(metric => {
      let sum = 0;
      let count = 0;

      group.posts.forEach(post => {
        const value = getValue(post, metric);
        if (value !== null && value !== undefined && !isNaN(parseFloat(value))) {
          sum += parseFloat(value);
          count++;
        }
      });

      metrics[metric] = count > 0 ? sum / count : 0;
      metrics[`${metric}_sum`] = sum;
    });

    return {
      post_type: group.post_type,
      post_count: postCount,
      percentage: metrics.percentage,
      is_reliable: isReliable,
      ...metrics
    };
  });

  return aggregatedData;
};

// Custom CSS-based Pie Chart component
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

      {/* Legend */}
      <div className="mt-6 grid grid-cols-2 gap-2">
        {sortedData.map((item, index) => (
          <div key={index} className="flex items-center">
            <div
              className="w-4 h-4 mr-2 flex-shrink-0"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            ></div>
            <div className="text-sm truncate">
              <span className="font-medium">{item.name}</span>
              <span className="ml-1 text-gray-500">
                ({(item.percentage).toFixed(1)}%)
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const PostTypeView = ({ data, selectedFields }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'post_count', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS);
  const [uniqueAccounts, setUniqueAccounts] = useState([]);
  const [aggregatedData, setAggregatedData] = useState([]);
  const [showOnlyReliable, setShowOnlyReliable] = useState(false);
  const [copyStatus, setCopyStatus] = useState({ field: null, rowId: null, copied: false });

  // Detect which platforms are present in the data
  const platforms = React.useMemo(() => {
    if (!data || !Array.isArray(data)) return new Set();
    return new Set(data.map(post => post._platform).filter(Boolean));
  }, [data]);

  const hasFacebook = platforms.has('facebook');
  const hasInstagram = platforms.has('instagram');

  // Determine which metric fields to show based on selectedFields and platform presence
  const visibleMetricFields = React.useMemo(() => {
    if (!selectedFields || !Array.isArray(selectedFields)) return [];
    return selectedFields.filter(field => {
      if (!ALL_METRIC_FIELDS.includes(field)) return false;
      // FB-specific fields: only show if FB data is present
      if (['total_clicks', 'link_clicks', 'other_clicks'].includes(field) && !hasFacebook) return false;
      // IG-specific fields: only show if IG data is present
      if (['saves', 'follows'].includes(field) && !hasInstagram) return false;
      return true;
    });
  }, [selectedFields, hasFacebook, hasInstagram]);

  // Get unique accounts from data
  useEffect(() => {
    if (data && Array.isArray(data)) {
      try {
        const accountNamesSet = new Set();
        for (const post of data) {
          const accountName = getValue(post, 'account_name');
          if (accountName) {
            accountNamesSet.add(accountName);
          }
        }
        const accounts = Array.from(accountNamesSet).sort();
        setUniqueAccounts(accounts);
      } catch (error) {
        console.error('Error fetching unique accounts:', error);
      }
    }
  }, [data]);

  // Aggregate data when source data or selected account changes
  useEffect(() => {
    if (data && Array.isArray(data)) {
      const aggregated = aggregateByPostType(data, selectedAccount);
      setAggregatedData(aggregated);
    }
  }, [data, selectedAccount]);

  // Reset to first page when data, pageSize or selected account changes
  useEffect(() => {
    setCurrentPage(1);
  }, [data, pageSize, selectedAccount]);

  // Reset copy status after 1.5 seconds
  useEffect(() => {
    if (copyStatus.copied) {
      const timer = setTimeout(() => {
        setCopyStatus({ field: null, rowId: null, copied: false });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [copyStatus]);

  // Handle sorting of columns
  const handleSort = (key) => {
    setSortConfig((currentSort) => ({
      key,
      direction: currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Handle copy to clipboard
  const handleCopyValue = (value, field, rowId) => {
    if (value === undefined || value === null) return;

    let rawValue;
    if (field === 'percentage') {
      rawValue = String(value.toFixed(1));
    } else if (typeof value === 'number' || (typeof value === 'string' && !isNaN(value.replace(/\s+/g, '')))) {
      rawValue = String(value).replace(/\s+/g, '').replace(/[^\d.,]/g, '');
    } else {
      rawValue = String(value);
    }

    navigator.clipboard.writeText(rawValue)
      .then(() => {
        setCopyStatus({ field, rowId, copied: true });
        console.log(`Kopierade ${rawValue} till urklipp`);
      })
      .catch(err => {
        console.error('Kunde inte kopiera till urklipp:', err);
      });
  };

  // Get icon for sorting
  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortConfig.direction === 'asc' ?
      <ArrowUp className="h-4 w-4 ml-1" /> :
      <ArrowDown className="h-4 w-4 ml-1" />;
  };

  // Get display name for a field
  const getDisplayName = (field) => {
    return DISPLAY_NAMES[field] || field;
  };

  // Format percentage values
  const formatPercentage = (value) => {
    if (value === null || value === undefined) return '-';
    return `${value.toFixed(1)}%`;
  };

  // Get pie chart data
  const getPieChartData = () => {
    return aggregatedData
      .slice()
      .sort((a, b) => b.post_count - a.post_count)
      .map(item => ({
        name: item.post_type,
        value: item.post_count,
        percentage: item.percentage
      }));
  };

  // Copy button component with hover effect and tooltip
  const CopyButton = ({ value, field, rowId }) => {
    const isCopied = copyStatus.copied && copyStatus.field === field && copyStatus.rowId === rowId;

    if (value === undefined || value === null || value === '' || value === '-') {
      return null;
    }

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

  // Apply filtering based on user settings
  const filteredAggregatedData = aggregatedData.filter(item => {
    if (showOnlyReliable && !item.is_reliable) {
      return false;
    }
    return true;
  });

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!sortConfig.key || !filteredAggregatedData) return filteredAggregatedData;

    return [...filteredAggregatedData].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

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
  }, [filteredAggregatedData, sortConfig]);

  // Paginate data
  const paginatedData = React.useMemo(() => {
    if (!sortedData) return [];
    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil((sortedData?.length || 0) / pageSize);

  // Format data for export
  const formatDataForExport = (data) => {
    if (!data || !Array.isArray(data)) return [];

    return data.map(item => {
      const exportRow = {
        'Inläggstyp': item.post_type,
        'Antal inlägg': item.post_count,
        'Andel': `${item.percentage.toFixed(1)}%`,
        'Tillförlitlig data': item.is_reliable ? 'Ja' : 'Nej'
      };

      for (const field of visibleMetricFields) {
        exportRow[getDisplayName(field)] = formatValue(item[field]);
      }

      return exportRow;
    });
  };

  // Export data to CSV
  const handleExportToCSV = async () => {
    try {
      const exportData = formatDataForExport(sortedData);
      if (!exportData || exportData.length === 0) return;

      const headers = Object.keys(exportData[0]);
      const csvRows = [
        headers.join(','),
        ...exportData.map(row =>
          headers.map(h => {
            const val = String(row[h] ?? '');
            return val.includes(',') ? `"${val}"` : val;
          }).join(',')
        )
      ];
      const csvContent = csvRows.join('\n');
      downloadFile(csvContent, 'meta-statistik-inlaggstyper.csv', 'text/csv');
    } catch (error) {
      console.error('Export till CSV misslyckades:', error);
    }
  };

  // Export data to Excel
  const handleExportToExcel = async () => {
    try {
      const exportData = formatDataForExport(sortedData);
      const result = await downloadExcel(exportData, 'meta-statistik-inlaggstyper.xlsx');
      if (result.success) {
        console.log('Export till Excel lyckades:', result.filePath);
      }
    } catch (error) {
      console.error('Export till Excel misslyckades:', error);
    }
  };

  // Account selector label depends on platforms present
  const accountSelectorLabel = hasFacebook && hasInstagram
    ? 'Visa konto:'
    : hasFacebook
    ? 'Visa sida:'
    : 'Visa konto:';

  const allAccountsLabel = hasFacebook && hasInstagram
    ? 'Alla konton'
    : hasFacebook
    ? 'Alla sidor'
    : 'Alla konton';

  return (
    <Card>
      <div className="flex flex-col space-y-4 p-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground">{accountSelectorLabel}</span>
              <Select
                value={selectedAccount}
                onValueChange={setSelectedAccount}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Välj konto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ACCOUNTS}>{allAccountsLabel}</SelectItem>
                  {uniqueAccounts.map(account => (
                    <SelectItem key={account} value={account}>
                      {account}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="reliable-stats"
                checked={showOnlyReliable}
                onCheckedChange={setShowOnlyReliable}
              />
              <Label htmlFor="reliable-stats">
                Visa endast tillförlitlig data (≥{MIN_POSTS_FOR_RELIABLE_STATS} inlägg)
              </Label>
            </div>
          </div>
          <div className="flex space-x-2">
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
        </div>

        {/* Pie Chart for Post Type Distribution */}
        {aggregatedData.length > 0 && (
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
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('post_type')}
                >
                  <div className="flex items-center whitespace-nowrap">
                    Inläggstyp {getSortIcon('post_type')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('post_count')}
                >
                  <div className="flex items-center whitespace-nowrap">
                    Antal {getSortIcon('post_count')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('percentage')}
                >
                  <div className="flex items-center whitespace-nowrap">
                    Andel {getSortIcon('percentage')}
                  </div>
                </TableHead>

                {visibleMetricFields.map(field => (
                  <TableHead
                    key={field}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort(field)}
                  >
                    <div className="flex items-center whitespace-nowrap">
                      Genomsnitt: {getDisplayName(field)} {getSortIcon(field)}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3 + visibleMetricFields.length} className="text-center py-6">
                    Ingen data tillgänglig
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((item, index) => (
                  <TableRow key={`${item.post_type}-${index}`} className={!item.is_reliable ? 'bg-gray-50' : ''}>
                    <TableCell className="font-medium">
                      <div className="flex items-center">
                        {item.post_type}
                        {!item.is_reliable && (
                          <AlertCircle
                            className="h-4 w-4 ml-2 text-yellow-500"
                            title="Mindre än 5 inlägg - statistiken kan vara missvisande"
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end group">
                        <span>{item.post_count}</span>
                        <CopyButton
                          value={item.post_count}
                          field="post_count"
                          rowId={`${item.post_type}-${index}`}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end group">
                        <span>{formatPercentage(item.percentage)}</span>
                        <CopyButton
                          value={item.percentage}
                          field="percentage"
                          rowId={`${item.post_type}-${index}`}
                        />
                      </div>
                    </TableCell>

                    {visibleMetricFields.map(field => (
                      <TableCell key={field} className="text-right">
                        <div className="flex items-center justify-end group">
                          <span>{formatValue(item[field])}</span>
                          <CopyButton
                            value={item[field]}
                            field={field}
                            rowId={`${item.post_type}-${index}`}
                          />
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Legend section */}
          <div className="bg-gray-50 border-t p-4">
            <div className="py-2 text-sm text-muted-foreground flex items-center">
              <AlertCircle className="h-4 w-4 mr-2 text-yellow-500" />
              <span>
                Inläggstyper med färre än {MIN_POSTS_FOR_RELIABLE_STATS} inlägg markeras med en gul cirkel och kan ha mindre tillförlitlig statistik.
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border-t">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-muted-foreground">Visa</span>
              <Select
                value={pageSize.toString()}
                onValueChange={size => {
                  setPageSize(Number(size));
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
              {sortedData.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  Visar {((currentPage - 1) * pageSize) + 1} till {Math.min(currentPage * pageSize, sortedData?.length || 0)} av {sortedData?.length || 0}
                </span>
              )}

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
      </div>
    </Card>
  );
};

export default PostTypeView;
