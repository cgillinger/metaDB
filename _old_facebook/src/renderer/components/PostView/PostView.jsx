import React, { useState, useEffect } from 'react';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, ExternalLink } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import {
  getValue,
  formatValue,
  formatDate,
  DISPLAY_NAMES
} from '@/utils/columnConfig';

// Definiera specifika fält för per-inlägg-vyn - håll detta synkat med MainView.jsx
const POST_VIEW_AVAILABLE_FIELDS = {
  'description': 'Beskrivning',
  'publish_time': 'Publiceringstid',
  'post_type': 'Typ',
  'reach': 'Räckvidd',
  'views': 'Sidvisningar',
  'total_engagement': 'Interaktioner',
  'likes': 'Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'total_clicks': 'Totalt antal klick',
  'other_clicks': 'Övriga klick',
  'link_clicks': 'Länkklick'
};

// Max längd för trunkerade beskrivningar
const MAX_DESCRIPTION_LENGTH = 100;

// Definiera sidstorlekar för pagineringen
const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

// Inläggstyper och deras färger
const POST_TYPE_COLORS = {
  'Foton': 'bg-blue-100 text-blue-800',
  'Länkar': 'bg-purple-100 text-purple-800',
  'Videor': 'bg-red-100 text-red-800',
  'Status': 'bg-green-100 text-green-800',
  'default': 'bg-gray-100 text-gray-800'
};

// Formatterad post-typ badge
const PostTypeBadge = ({ type }) => {
  if (!type) return null;
  
  const colorClass = POST_TYPE_COLORS[type] || POST_TYPE_COLORS.default;
  
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colorClass}`}>
      {type}
    </span>
  );
};

// Huvudkomponent för PostView
const PostView = ({ data, selectedFields }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'publish_time', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [uniqueAccounts, setUniqueAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('all');
  const [expandedDescriptions, setExpandedDescriptions] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Extrahera unika kontonamn från data
  useEffect(() => {
    if (data && Array.isArray(data)) {
      try {
        // Hitta unika kontonamn
        const accountNames = new Set();
        
        data.forEach(post => {
          const accountName = getValue(post, 'account_name');
          if (accountName) {
            accountNames.add(accountName);
          }
        });
        
        // Konvertera Set till sorterad array
        const sortedNames = Array.from(accountNames).sort();
        setUniqueAccounts(sortedNames);
      } catch (error) {
        console.error('Fel vid hämtning av unika kontonamn:', error);
      }
    }
  }, [data]);

  // Återställ till första sidan när data eller pageSize ändras
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

  // Växla expandering av beskrivning
  const toggleDescription = (postId) => {
    setExpandedDescriptions(prev => ({
      ...prev,
      [postId]: !prev[postId]
    }));
  };

  // Hantera öppnande av extern länk
  const handleExternalLink = (postId, accountId) => {
    try {
      if (!postId || postId === '-') return;
      
      // Bygg Facebook URL (notera att permalink-fältet skulle kunna användas om det finns)
      let facebookUrl;
      
      if (accountId) {
        // För Facebook är formatet vanligtvis: https://www.facebook.com/{accountId}/posts/{postId}
        facebookUrl = `https://www.facebook.com/${accountId}/posts/${postId}`;
      } else {
        // Fallback om inget accountId finns
        facebookUrl = `https://www.facebook.com/${postId}`;
      }
      
      if (window.electronAPI?.openExternalLink) {
        window.electronAPI.openExternalLink(facebookUrl);
      } else {
        window.open(facebookUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      console.error('Failed to open external link:', error);
    }
  };

  // Formatera beskrivning med läs mer-funktion
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

  // Få ikon för sortering
  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortConfig.direction === 'asc' ? 
      <ArrowUp className="h-4 w-4 ml-1" /> : 
      <ArrowDown className="h-4 w-4 ml-1" />;
  };

  // Hämta visningsnamn för ett fält
  const getDisplayName = (field) => {
    return POST_VIEW_AVAILABLE_FIELDS[field] || DISPLAY_NAMES[field] || field;
  };

  // Filtrera och sortera data baserat på aktuella inställningar
  const filteredAndSortedData = React.useMemo(() => {
    if (!Array.isArray(data)) return [];
    
    // Filtrera baserat på valt konto
    let filteredData = data;
    if (selectedAccount !== 'all') {
      filteredData = data.filter(post => 
        getValue(post, 'account_name') === selectedAccount
      );
    }
    
    // Om ingen sorteringsnyckel eller ingen data, returnera endast filtrerad data
    if (!sortConfig.key || filteredData.length === 0) return filteredData;
    
    // Sortera data
    return [...filteredData].sort((a, b) => {
      const aValue = getValue(a, sortConfig.key);
      const bValue = getValue(b, sortConfig.key);
      
      // Hantera null-värden i sortering
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      
      // Sortera numeriska värden numeriskt
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      // För datum, konvertera till Date-objekt och jämför
      if (sortConfig.key === 'publish_time') {
        const aDate = new Date(aValue);
        const bDate = new Date(bValue);
        
        if (!isNaN(aDate) && !isNaN(bDate)) {
          return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
        }
      }
      
      // För strängar, gör en enkel alfabetisk jämförelse
      const aStr = String(aValue || '').toLowerCase();
      const bStr = String(bValue || '').toLowerCase();
      return sortConfig.direction === 'asc' ? 
        aStr.localeCompare(bStr) : 
        bStr.localeCompare(aStr);
    });
  }, [data, selectedAccount, sortConfig]);

  // Paginera data
  const paginatedData = React.useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredAndSortedData.slice(startIndex, startIndex + pageSize);
  }, [filteredAndSortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredAndSortedData.length / pageSize);

  // Hantera export till Excel
  const handleExportToExcel = async () => {
    try {
      const exportData = formatDataForExport(filteredAndSortedData);
      
      const accountSuffix = selectedAccount !== 'all' 
        ? `-${selectedAccount.replace(/\s+/g, '-')}` 
        : '';
      
      const result = await window.electronAPI.exportToExcel(
        exportData,
        `facebook-statistik-inlagg${accountSuffix}.xlsx`
      );
      
      if (result.success) {
        console.log('Export till Excel lyckades:', result.filePath);
      }
    } catch (error) {
      console.error('Export till Excel misslyckades:', error);
    }
  };

  // Hantera export till CSV
  const handleExportToCSV = async () => {
    try {
      const exportData = formatDataForExport(filteredAndSortedData);
      
      const accountSuffix = selectedAccount !== 'all' 
        ? `-${selectedAccount.replace(/\s+/g, '-')}` 
        : '';
      
      const result = await window.electronAPI.exportToCSV(
        exportData,
        `facebook-statistik-inlagg${accountSuffix}.csv`
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
    return data.map(post => {
      const exportObject = {
        Sidnamn: getValue(post, 'account_name') || 'Okänd sida',
        Beskrivning: getValue(post, 'description') || '',
        Publiceringstid: getValue(post, 'publish_time') || '',
        Typ: getValue(post, 'post_type') || ''
      };
      
      // Lägg till valda fält
      selectedFields.forEach(field => {
        if (!['account_name', 'description', 'publish_time', 'post_type'].includes(field)) {
          const displayName = getDisplayName(field);
          exportObject[displayName] = formatValue(getValue(post, field));
        }
      });
      
      return exportObject;
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

  // Om ingen data finns, visa meddelande
  if (!Array.isArray(filteredAndSortedData) || filteredAndSortedData.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Ingen data tillgänglig för valda filter
        </p>
      </Card>
    );
  }

  // Identifiera vilka kolumner som ska visas baserat på selectedFields
  const showPostType = selectedFields.includes('post_type');

  return (
    <Card>
      <div className="flex flex-col space-y-4 p-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-muted-foreground">Visa sida:</span>
            <Select
              value={selectedAccount}
              onValueChange={setSelectedAccount}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Välj sida" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla sidor</SelectItem>
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

        <div className="rounded-md border overflow-x-auto bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                
                {/* Sidnamn kolumn är alltid inkluderad */}
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('account_name')}
                >
                  <div className="flex items-center whitespace-nowrap">
                    Sidnamn {getSortIcon('account_name')}
                  </div>
                </TableHead>
                
                {/* Beskrivning är alltid inkluderad */}
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('description')}
                >
                  <div className="flex items-center">
                    Beskrivning {getSortIcon('description')}
                  </div>
                </TableHead>
                
                {/* Publiceringstid är alltid inkluderad */}
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50 w-40"
                  onClick={() => handleSort('publish_time')}
                >
                  <div className="flex items-center whitespace-nowrap">
                    Publiceringstid {getSortIcon('publish_time')}
                  </div>
                </TableHead>
                
                {/* Typ kolumn visas endast om post_type är valt */}
                {showPostType && (
                  <TableHead 
                    className="cursor-pointer hover:bg-muted/50 w-28"
                    onClick={() => handleSort('post_type')}
                  >
                    <div className="flex items-center whitespace-nowrap">
                      Typ {getSortIcon('post_type')}
                    </div>
                  </TableHead>
                )}
                
                {/* Lägg till valda fält som kolumner */}
                {selectedFields.map(field => {
                  // Hoppa över fält som redan är inkluderade
                  if (['description', 'publish_time', 'account_name', 'post_type'].includes(field)) {
                    return null;
                  }
                  
                  return (
                    <TableHead 
                      key={field}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleSort(field)}
                    >
                      <div className="flex items-center justify-end">
                        {getDisplayName(field)} {getSortIcon(field)}
                      </div>
                    </TableHead>
                  );
                })}
                
                <TableHead className="w-12 text-center">
                  Länk
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.map((post, index) => {
                const postId = getValue(post, 'post_id');
                const accountId = getValue(post, 'account_id');
                const description = getValue(post, 'description');
                const publishTime = getValue(post, 'publish_time');
                const accountName = getValue(post, 'account_name');
                const postType = getValue(post, 'post_type');
                
                return (
                  <TableRow key={postId || index}>
                    <TableCell className="text-center font-medium">
                      {(currentPage - 1) * pageSize + index + 1}
                    </TableCell>
                    
                    <TableCell className="font-medium">
                      {accountName || 'Okänd sida'}
                    </TableCell>
                    
                    <TableCell>
                      {formatDescription(description, postId || index)}
                    </TableCell>
                    
                    <TableCell className="whitespace-nowrap">
                      {formatDate(publishTime)}
                    </TableCell>
                    
                    {/* Visa Typ-fältet om det är valt */}
                    {showPostType && (
                      <TableCell className="text-center">
                        <PostTypeBadge type={postType} />
                      </TableCell>
                    )}
                    
                    {selectedFields.map(field => {
                      // Hoppa över fält som redan är inkluderade
                      if (['description', 'publish_time', 'account_name', 'post_type'].includes(field)) {
                        return null;
                      }
                      
                      return (
                        <TableCell key={field} className="text-right">
                          {formatValue(getValue(post, field))}
                        </TableCell>
                      );
                    })}
                    
                    <TableCell className="text-center">
                      {postId && (
                        <button
                          onClick={() => handleExternalLink(postId, accountId)}
                          className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800"
                          title="Öppna i Facebook"
                        >
                          <ExternalLink className="h-4 w-4" />
                          <span className="sr-only">Öppna Facebook-inlägg</span>
                        </button>
                      )}
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
                onValueChange={(value) => setPageSize(Number(value))}
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
                Visar {((currentPage - 1) * pageSize) + 1} till {Math.min(currentPage * pageSize, filteredAndSortedData.length)} av {filteredAndSortedData.length}
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
      </div>
    </Card>
  );
};

export default PostView;