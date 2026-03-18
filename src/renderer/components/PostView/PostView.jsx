import React, { useState, useEffect } from 'react';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet } from 'lucide-react';
import { POST_VIEW_FIELDS, getUniquePageNames } from '../../../utils/dataProcessing';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import {
  getValue,
  formatValue,
  formatDate,
  DISPLAY_NAMES
} from '@/utils/columnConfig';

const ALL_ACCOUNTS = 'all_accounts';

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

// Definiera specifika fält för per-inlägg-vyn - håll detta synkat med MainView.jsx
const POST_VIEW_AVAILABLE_FIELDS = {
  'post_reach': 'Räckvidd',
  'views': 'Visningar',
  'engagement_total': 'Interaktioner',
  'engagement_total_extended': 'Totalt engagemang (alla typer)',
  'likes': 'Gilla-markeringar',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare'
};

const PostView = ({ data, selectedFields }) => {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS);
  const [uniqueAccounts, setUniqueAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Hämta unika konton från data
  useEffect(() => {
    if (data && Array.isArray(data)) {
      try {
        // Skapa set för att hålla unika kontonamn
        const accountNamesSet = new Set();
        
        // Gå igenom varje inlägg och hämta kontonamn
        for (const post of data) {
          const accountName = getValue(post, 'account_name');
          if (accountName) {
            accountNamesSet.add(accountName);
          }
        }
        
        // Konvertera set till sorterad array
        const accounts = Array.from(accountNamesSet).sort();
        setUniqueAccounts(accounts);
      } catch (error) {
        console.error('Error fetching unique accounts:', error);
      }
    }
  }, [data]);

  // Återställ till första sidan när data, pageSize eller valt konto ändras
  useEffect(() => {
    setCurrentPage(1);
  }, [data, pageSize, selectedAccount]);

  // Hantera sortering av kolumner
  const handleSort = (key) => {
    setSortConfig((currentSort) => ({
      key,
      direction: currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Hämta ikon för sortering
  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortConfig.direction === 'asc' ? 
      <ArrowUp className="h-4 w-4 ml-1" /> : 
      <ArrowDown className="h-4 w-4 ml-1" />;
  };

  // Hantera klick på extern länk
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

  // Hämta visningsnamn för ett fält från POST_VIEW_AVAILABLE_FIELDS
  const getDisplayName = (field) => {
    // Använd samma definitioner som i MainView.jsx för konsistent visning
    return POST_VIEW_AVAILABLE_FIELDS[field] || DISPLAY_NAMES[field] || POST_VIEW_FIELDS[field] || field;
  };

  // Filtrera data baserat på valt konto
  const filteredData = React.useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    if (selectedAccount === ALL_ACCOUNTS) return data;
    
    return data.filter(post => {
      const accountName = getValue(post, 'account_name');
      return accountName === selectedAccount;
    });
  }, [data, selectedAccount]);

  // Sortera data baserat på aktuell sorteringskonfiguration
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
      return sortConfig.direction === 'asc' ? 
        aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
  }, [filteredData, sortConfig]);

  // Paginera data
  const paginatedData = React.useMemo(() => {
    if (!sortedData) return [];
    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil((sortedData?.length || 0) / pageSize);

  // Exportera data till Excel
  const handleExportToExcel = async () => {
    try {
      const exportData = formatDataForExport(sortedData);
      const result = await window.electronAPI.exportToExcel(
        exportData,
        'instagram-statistik-inlagg.xlsx'
      );
      if (result.success) {
        console.log('Export till Excel lyckades:', result.filePath);
      }
    } catch (error) {
      console.error('Export till Excel misslyckades:', error);
    }
  };

  // Exportera data till CSV
  const handleExportToCSV = async () => {
    try {
      const exportData = formatDataForExport(sortedData);
      const result = await window.electronAPI.exportToCSV(
        exportData,
        'instagram-statistik-inlagg.csv'
      );
      if (result.success) {
        console.log('Export till CSV lyckades:', result.filePath);
      }
    } catch (error) {
      console.error('Export till CSV misslyckades:', error);
    }
  };

  // Formatera data för export
  const formatDataForExport = (data) => {
    if (!data || !Array.isArray(data)) return [];
    
    return data.map(post => {
      const formattedPost = {
        'Beskrivning': getValue(post, 'description') || 'Ingen beskrivning',
        'Datum': formatDate(getValue(post, 'publish_time')),
        'Kontonamn': getValue(post, 'account_name')
      };

      for (const field of selectedFields) {
        // För export använder vi fortfarande POST_VIEW_FIELDS från dataProcessing
        const displayName = POST_VIEW_FIELDS[field] || getDisplayName(field);
        formattedPost[displayName] = formatValue(getValue(post, field));
      }

      return formattedPost;
    });
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

  // Om data laddar, visa laddningsmeddelande
  if (isLoading) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Laddar data...
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex justify-between items-center p-4">
        <div className="flex items-center space-x-4">
          <span className="text-sm text-muted-foreground">Visa konto:</span>
          <Select
            value={selectedAccount}
            onValueChange={setSelectedAccount}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Välj konto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACCOUNTS}>Alla konton</SelectItem>
              {uniqueAccounts.map(account => (
                <SelectItem key={account} value={account}>
                  {account}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <div className="rounded-md overflow-x-auto bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              {/* Lägg till kolumnrubrik för radnummer */}
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead 
                className="w-1/3 cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('description')}
              >
                <div className="flex items-center">
                  {getDisplayName('description')} {getSortIcon('description')}
                </div>
              </TableHead>
              <TableHead 
                className="w-24 whitespace-nowrap cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('publish_time')}
              >
                <div className="flex items-center">
                  {getDisplayName('publish_time')} {getSortIcon('publish_time')}
                </div>
              </TableHead>
              <TableHead 
                className="w-28 cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('account_name')}
              >
                <div className="flex items-center">
                  {getDisplayName('account_name')} {getSortIcon('account_name')}
                </div>
              </TableHead>
              {selectedFields.map(field => (
                <TableHead 
                  key={field}
                  className="w-28 cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort(field)}
                >
                  <div className="flex items-center">
                    {getDisplayName(field)} {getSortIcon(field)}
                  </div>
                </TableHead>
              ))}
              <TableHead className="w-12 text-center">
                {getDisplayName('permalink')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.map((post, index) => (
              <TableRow key={`post-${index}`}>
                {/* Visa radnummer i stigande ordning */}
                <TableCell className="text-center font-medium">
                  {(currentPage - 1) * pageSize + index + 1}
                </TableCell>
                <TableCell className="max-w-md">
                  <div className="flex flex-col">
                    <span className="text-sm text-muted-foreground line-clamp-2">
                      {getValue(post, 'description') || 'Ingen beskrivning'}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(getValue(post, 'publish_time'))}
                </TableCell>
                <TableCell>{formatValue(getValue(post, 'account_name'))}</TableCell>
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
                      <span className="sr-only">Öppna inlägg</span>
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

export default PostView;