import React, { useState, useEffect, useMemo, useRef } from 'react';
import PlatformBadge from '../ui/PlatformBadge';
import InfoTooltip from '../ui/InfoTooltip';
import CollabBadge from '../ui/CollabBadge';
import DescriptionCell from '../ui/DescriptionCell';
import { Card } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { formatValue, formatDate, formatDateHuman, DISPLAY_NAMES, ENGAGEMENT_INFO } from '@/utils/columnConfig';
import { api, downloadFile, downloadExcel, openExternalLink } from '@/utils/apiClient';
import ProfileIcon from '../ui/ProfileIcon';
import { FB_ONLY_FIELDS, NON_FB_FIELDS } from '@/utils/fieldPlatforms';

const ALL_ACCOUNTS = 'all_accounts';

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 per sida' },
  { value: '20', label: '20 per sida' },
  { value: '50', label: '50 per sida' }
];

const POST_VIEW_AVAILABLE_FIELDS = {
  'reach': 'Räckvidd',
  'views': 'Visningar',
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
  'description': 'Beskrivning',
  'publish_time': 'Publiceringstid',
  'account_name': 'Kontonamn',
  'permalink': 'Länk',
  'post_type': 'Typ'
};

// Plattformslistorna importeras från fieldPlatforms (en sanningskälla).

const getDisplayName = (field) => POST_VIEW_AVAILABLE_FIELDS[field] || DISPLAY_NAMES[field] || field;

const PostTypeBadge = ({ type }) => {
  if (!type) return null;
  const colorMap = {
    'Foton': 'bg-blue-100 text-blue-800', 'Bilder': 'bg-blue-100 text-blue-800',
    'Photos': 'bg-blue-100 text-blue-800',
    'Länkar': 'bg-purple-100 text-purple-800', 'Videor': 'bg-red-100 text-red-800',
    'Status': 'bg-green-100 text-green-800', 'Text': 'bg-green-100 text-green-800',
    'Reels': 'bg-orange-100 text-orange-800', 'Live': 'bg-red-100 text-red-800',
    'Stories': 'bg-yellow-100 text-yellow-800',
    'IG image': 'bg-blue-100 text-blue-800', 'IG reel': 'bg-orange-100 text-orange-800',
    'IG carousel': 'bg-indigo-100 text-indigo-800',
    'default': 'bg-gray-100 text-gray-800'
  };
  return <span className={`px-2 py-1 text-xs font-medium rounded-full ${colorMap[type] || colorMap.default}`}>{type}</span>;
};

const PostView = ({ selectedFields, platform, periodParams = {} }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'publish_time', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS);

  const [posts, setPosts] = useState([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [uniqueAccounts, setUniqueAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMixedData, setHasMixedData] = useState(false);

  // Fetch posts from API with server-side pagination & sorting.
  // Stale-flag guards against out-of-order responses on rapid filter changes:
  // only the latest request may update state or release the loading flag.
  useEffect(() => {
    let cancelled = false;
    const fetchPosts = async () => {
      setLoading(true);
      try {
        const params = {
          page: currentPage,
          pageSize: pageSize,
          sort: sortConfig.key,
          order: sortConfig.direction,
          ...periodParams,
        };
        if (platform) params.platform = platform;
        if (selectedAccount !== ALL_ACCOUNTS) {
          const sepIdx = selectedAccount.lastIndexOf('::');
          if (sepIdx !== -1) {
            params.accountName = selectedAccount.slice(0, sepIdx);
            params.accountPlatform = selectedAccount.slice(sepIdx + 2);
          } else {
            params.accountName = selectedAccount;
          }
        }

        const data = await api.getPosts(params);
        if (cancelled) return;
        setPosts(data.data || []);
        setTotalPosts(data.total || 0);
        setTotalPages(data.totalPages || 0);
      } catch (error) {
        console.error('Fel vid hämtning av inlägg:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchPosts();
    return () => { cancelled = true; };
  }, [currentPage, pageSize, sortConfig, platform, selectedAccount, periodParams]);

  // Fetch unique accounts for filter dropdown
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const params = { fields: 'views', ...periodParams };
        if (platform) params.platform = platform;
        const data = await api.getAccounts(params);
        const accounts = (data.accounts || [])
          .map(a => ({
            name: a.account_name,
            platform: a.platform,
            isCollab: a.is_collab,
            key: `${a.account_name}::${a.platform}`,
          }))
          .sort((a, b) => (a.name || '').localeCompare((b.name || ''), 'sv'));
        setUniqueAccounts(accounts);
        const platforms = new Set(accounts.map(a => a.platform));
        setHasMixedData(platforms.size > 1);
      } catch (error) {
        console.error('Fel vid hämtning av konton:', error);
      }
    };
    fetchAccounts();
  }, [platform, periodParams]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, selectedAccount, platform, periodParams]);

  // Auto-sort when a new field is added
  const prevFieldsRef = useRef(selectedFields);
  useEffect(() => {
    const prev = prevFieldsRef.current;
    prevFieldsRef.current = selectedFields;
    if (selectedFields.length > prev.length) {
      const newField = selectedFields.find(f => !prev.includes(f));
      if (newField && !['description', 'publish_time', 'account_name', 'post_type', 'permalink'].includes(newField)) {
        setSortConfig({ key: newField, direction: 'desc' });
        setCurrentPage(1);
      }
    }
  }, [selectedFields]);

  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
    setCurrentPage(1);
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="h-4 w-4 ml-1" /> : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const handleExternalLink = (post) => {
    try {
      if (post.permalink) { openExternalLink(post.permalink); return; }
      const postId = post.post_id;
      if (!postId) return;
      let url;
      if (post.platform === 'instagram') url = `https://www.instagram.com/p/${postId}/`;
      else if (post.account_id) url = `https://www.facebook.com/${post.account_id}/posts/${postId}`;
      else url = `https://www.facebook.com/${postId}`;
      openExternalLink(url);
    } catch (error) {
      console.error('Failed to open external link:', error);
    }
  };

  const renderFieldValue = (post, field) => {
    const plat = post.platform;
    if (FB_ONLY_FIELDS.includes(field) && plat === 'instagram') return <span className="text-muted-foreground text-xs">N/A</span>;
    if (NON_FB_FIELDS.includes(field) && plat === 'facebook') return <span className="text-muted-foreground text-xs">N/A</span>;
    return formatValue(post[field]);
  };

  // Export fetches ALL matching posts (not just current page) via the
  // server's unpaginated mode (paginate=false) — a huge pageSize would be
  // clamped to 100 server-side and silently truncate the export.
  const handleExportToCSV = async () => {
    try {
      const params = { paginate: 'false', sort: sortConfig.key, order: sortConfig.direction, ...periodParams };
      if (platform) params.platform = platform;
      if (selectedAccount !== ALL_ACCOUNTS) {
        const sepIdx = selectedAccount.lastIndexOf('::');
        if (sepIdx !== -1) {
          params.accountName = selectedAccount.slice(0, sepIdx);
          params.accountPlatform = selectedAccount.slice(sepIdx + 2);
        } else {
          params.accountName = selectedAccount;
        }
      }
      const data = await api.getPosts(params);
      const allPosts = data.data || [];

      const exportData = allPosts.map(post => {
        const plat = post.platform;
        const row = {
          'Plattform': plat === 'facebook' ? 'Facebook' : plat === 'instagram' ? 'Instagram' : '',
          'Kontonamn': post.account_name || '',
          'Beskrivning': post.description || 'Ingen beskrivning',
          'Publiceringstid': formatDate(post.publish_time),
          'Typ': post.post_type || ''
        };
        for (const field of selectedFields) {
          if (['account_name', 'description', 'publish_time', 'post_type'].includes(field)) continue;
          const displayName = getDisplayName(field);
          if (FB_ONLY_FIELDS.includes(field) && plat === 'instagram') { row[displayName] = 'N/A'; continue; }
          if (NON_FB_FIELDS.includes(field) && plat === 'facebook') { row[displayName] = 'N/A'; continue; }
          row[displayName] = formatValue(post[field]);
        }
        return row;
      });

      if (!exportData.length) return;
      const headers = Object.keys(exportData[0]);
      const csvRows = [headers.join(',')];
      exportData.forEach(row => {
        csvRows.push(headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','));
      });
      const accountSuffix = selectedAccount !== ALL_ACCOUNTS ? `-${selectedAccount.split('::')[0].replace(/\s+/g, '-')}` : '';
      downloadFile(csvRows.join('\n'), `meta-statistik-inlagg${accountSuffix}.csv`, 'text/csv;charset=utf-8;');
    } catch (error) {
      console.error('Export till CSV misslyckades:', error);
    }
  };

  const handleExportToExcel = async () => {
    try {
      const params = { paginate: 'false', sort: sortConfig.key, order: sortConfig.direction, ...periodParams };
      if (platform) params.platform = platform;
      if (selectedAccount !== ALL_ACCOUNTS) {
        const sepIdx = selectedAccount.lastIndexOf('::');
        if (sepIdx !== -1) {
          params.accountName = selectedAccount.slice(0, sepIdx);
          params.accountPlatform = selectedAccount.slice(sepIdx + 2);
        } else {
          params.accountName = selectedAccount;
        }
      }
      const data = await api.getPosts(params);
      const allPosts = data.data || [];

      const exportData = allPosts.map(post => {
        const plat = post.platform;
        const row = {
          'Plattform': plat === 'facebook' ? 'Facebook' : plat === 'instagram' ? 'Instagram' : '',
          'Kontonamn': post.account_name || '',
          'Beskrivning': post.description || 'Ingen beskrivning',
          'Publiceringstid': formatDate(post.publish_time),
          'Typ': post.post_type || ''
        };
        for (const field of selectedFields) {
          if (['account_name', 'description', 'publish_time', 'post_type'].includes(field)) continue;
          const displayName = getDisplayName(field);
          if (FB_ONLY_FIELDS.includes(field) && plat === 'instagram') { row[displayName] = 'N/A'; continue; }
          if (NON_FB_FIELDS.includes(field) && plat === 'facebook') { row[displayName] = 'N/A'; continue; }
          row[displayName] = formatValue(post[field]);
        }
        return row;
      });

      if (!exportData.length) return;
      const accountSuffix = selectedAccount !== ALL_ACCOUNTS ? `-${selectedAccount.split('::')[0].replace(/\s+/g, '-')}` : '';
      await downloadExcel(exportData, `meta-statistik-inlagg${accountSuffix}.xlsx`);
    } catch (error) {
      console.error('Export till Excel misslyckades:', error);
    }
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
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Välj konto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACCOUNTS}>Alla konton</SelectItem>
              {uniqueAccounts.map(({ name, platform: plat, isCollab, key }) => (
                <SelectItem key={key} value={key}>
                  <span className="flex items-center gap-2">
                    {name}
                    <PlatformBadge platform={plat} />
                    {isCollab ? <CollabBadge compact /> : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={handleExportToCSV}><FileDown className="w-4 h-4 mr-2" />CSV</Button>
          <Button variant="outline" onClick={handleExportToExcel}><FileSpreadsheet className="w-4 h-4 mr-2" />Excel</Button>
        </div>
      </div>

      <div className="rounded-md overflow-x-auto bg-white">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('publish_time')}>
                <div className="flex items-center">Inlägg {getSortIcon('publish_time')}</div>
              </TableHead>
              {selectedFields.map(field => {
                if (['description', 'publish_time', 'account_name', 'post_type'].includes(field)) return null;
                return (
                  <TableHead key={field} className="w-[130px] cursor-pointer hover:bg-muted/50" onClick={() => handleSort(field)}>
                    <div className="flex items-center justify-end whitespace-nowrap">
                      {getDisplayName(field)}
                      {field === 'engagement' && hasMixedData && <InfoTooltip text="Engagemanget beräknas olika per plattform. FB: inkl. klick. IG: inkl. sparade & följare." />}
                      {getSortIcon(field)}
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2 + selectedFields.filter(f => !['description', 'publish_time', 'account_name', 'post_type'].includes(f)).length} className="text-center text-muted-foreground py-8">
                  {loading ? 'Laddar...' : 'Ingen data tillgänglig för valda filter'}
                </TableCell>
              </TableRow>
            ) : posts.map((post, index) => (
              <TableRow key={`post-${post.post_id || index}`}>
                <TableCell className="text-center font-medium align-top pt-5 text-muted-foreground">
                  {(currentPage - 1) * pageSize + index + 1}
                </TableCell>
                <TableCell className="py-4">
                  <div className="flex gap-3">
                    <ProfileIcon accountName={post.account_name} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        <span className="text-sm font-medium">{post.account_name || 'Okänt konto'}</span>
                        <PlatformBadge platform={post.platform} />
                        <PostTypeBadge type={post.post_type} />
                        {post.is_collab ? <CollabBadge compact /> : null}
                      </div>
                      <div className="text-sm leading-relaxed">
                        <DescriptionCell description={post.description} lines={3} />
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{formatDateHuman(post.publish_time)}</span>
                        <button
                          onClick={() => handleExternalLink(post)}
                          className="inline-flex items-center gap-1 text-primary hover:text-primary/80 hover:underline"
                        >
                          Öppna inlägg
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </TableCell>
                {selectedFields.map(field => {
                  if (['description', 'publish_time', 'account_name', 'post_type'].includes(field)) return null;
                  const showMixedIcon = field === 'engagement' && hasMixedData;
                  const mixedTip = showMixedIcon ? (post.platform === 'facebook' ? ENGAGEMENT_INFO.facebook : ENGAGEMENT_INFO.instagram) : null;
                  return (
                    <TableCell key={field} className="text-right align-top pt-5 w-[130px]">
                      <span className="inline-flex items-center justify-end gap-1 text-lg font-medium whitespace-nowrap tabular-nums">
                        {renderFieldValue(post, field)}
                        {showMixedIcon && <InfoTooltip text={mixedTip} />}
                      </span>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>

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
            <span className="text-sm text-muted-foreground">
              Visar {totalPosts > 0 ? ((currentPage - 1) * pageSize) + 1 : 0} till {Math.min(currentPage * pageSize, totalPosts)} av {totalPosts}
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

export default PostView;
