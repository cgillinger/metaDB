import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui/table';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  FileText,
  Trash2,
  AlertCircle,
  RefreshCw,
  Calendar,
  BarChart3,
  Users,
  Database,
  HardDrive,
  Download,
  Plus,
  Pencil,
  FolderOpen,
  FileSpreadsheet,
  AlertTriangle,
  EyeOff,
} from 'lucide-react';
import { api } from '@/utils/apiClient';
import GroupCreateDialog from '../AccountGroups/GroupCreateDialog';
import HiddenAccountsManager from '../HiddenAccountsManager/HiddenAccountsManager';

const PLATFORM_LABELS = {
  facebook: { label: 'Facebook', className: 'bg-blue-100 text-blue-800' },
  instagram: { label: 'Instagram', className: 'bg-pink-100 text-pink-800' },
};

const PlatformBadge = ({ platform }) => {
  if (!platform) return null;
  const config = PLATFORM_LABELS[platform.toLowerCase()] || { label: platform, className: 'bg-gray-100 text-gray-700' };
  return <span className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded ml-2 ${config.className}`}>{config.label}</span>;
};

const SOURCE_LABELS = {
  ga_listens: 'GA-lyssningar',
  ga_site_visits: 'GA-besök',
  posts: 'Inlägg',
};

const ImportManager = ({ onImportsChanged, accountGroups = [], onGroupsChanged }) => {
  const [imports, setImports] = useState([]);
  const [stats, setStats] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [reachMonths, setReachMonths] = useState([]);
  const [viewersMonths, setViewersMonths] = useState([]);
  const [igReachMonths, setIgReachMonths] = useState([]);
  const [gaListensMonths, setGaListensMonths] = useState([]);
  const [openGaps, setOpenGaps] = useState([]);
  const [gapsSortMode, setGapsSortMode] = useState('alphabetical');
  const [gapsViewMode, setGapsViewMode] = useState('account'); // 'account' | 'month'
  const [retiringGapKey, setRetiringGapKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [vacuuming, setVacuuming] = useState(false);

  // Group management state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [dialogAccounts, setDialogAccounts] = useState([]);
  const [dialogSource, setDialogSource] = useState('ga_listens');
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [newGroupSource, setNewGroupSource] = useState('ga_listens');
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [importsData, statsData, coverageData, reachMonthsData, viewersMonthsData, igReachMonthsData, gaMonthsData, gapsData] = await Promise.all([
        api.getImports(),
        // Stats must not fail the whole load — the import list should still
        // show; the stats cards then render empty via their ?. fallbacks.
        api.getStats().catch(() => null),
        api.getCoverage().catch(() => null),
        api.getReachMonths().catch(() => ({ months: [] })),
        api.getViewersMonths().catch(() => ({ months: [] })),
        api.getIGReachMonths().catch(() => ({ months: [] })),
        api.getGAListensMonths().catch(() => ({ months: [] })),
        api.getOpenGaps().catch(() => ({ gaps: [] })),
      ]);
      setImports(importsData);
      setStats(statsData);
      setCoverage(coverageData);
      setReachMonths(reachMonthsData.months || []);
      setViewersMonths(viewersMonthsData.months || []);
      setIgReachMonths(igReachMonthsData.months || []);
      setGaListensMonths(gaMonthsData.months || []);
      setOpenGaps(gapsData.gaps || []);
    } catch (error) {
      console.error('Fel vid hämtning av importdata:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleDeleteImport = async (id) => {
    try {
      await api.deleteImport(id);
      setDeleteConfirm(null);
      await fetchData();
      if (onImportsChanged) onImportsChanged();
    } catch (error) {
      console.error('Fel vid borttagning av import:', error);
    }
  };

  const handleRetireGapAccount = async (accountName, platform) => {
    const key = `${accountName}::${platform}`;
    setRetiringGapKey(key);
    try {
      await api.retireAccount(accountName, platform);
      setOpenGaps(prev => prev.filter(g => !(g.account_name === accountName && g.platform === platform)));
    } catch (error) {
      console.error('Fel vid avveckling av konto:', error);
    } finally {
      setRetiringGapKey(null);
    }
  };

  const GAPS_SORT_LABELS = {
    alphabetical: 'Bokstavsordning',
    months: 'Flest saknade månader',
    reach: 'Störst räckvidd i luckorna',
  };

  const sortedOpenGaps = useMemo(() => {
    const byName = (a, b) => a.account_name.localeCompare(b.account_name, 'sv');
    const sorted = [...openGaps];
    if (gapsSortMode === 'months') {
      sorted.sort((a, b) => b.months.length - a.months.length || byName(a, b));
    } else if (gapsSortMode === 'reach') {
      sorted.sort((a, b) => (b.gap_reach || 0) - (a.gap_reach || 0) || byName(a, b));
    } else {
      sorted.sort(byName);
    }
    return sorted;
  }, [openGaps, gapsSortMode]);

  // Invert openGaps (per konto -> months) to per månad -> konton, for the
  // "Per månad" view: which accounts to select for a Meta Business Suite
  // re-export of a given month.
  const gapsByMonth = useMemo(() => {
    const byMonth = new Map();
    for (const g of openGaps) {
      for (const month of g.months) {
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month).push({ account_name: g.account_name, platform: g.platform });
      }
    }
    return [...byMonth.entries()]
      .map(([month, accounts]) => ({
        month,
        accounts: [...accounts].sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv')),
      }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [openGaps]);

  const handleVacuum = async () => {
    setVacuuming(true);
    try {
      await api.vacuum();
      await fetchData();
    } catch (error) {
      console.error('Fel vid VACUUM:', error);
    } finally {
      setVacuuming(false);
    }
  };

  const fetchAccountsForSource = async (source) => {
    setLoadingAccounts(true);
    try {
      if (source === 'ga_listens') {
        const result = await api.getGAListensSummary(null);
        const programmes = result.programmes || [];
        return programmes.map(p => ({
          account_name: p.account_name,
          platform: 'ga_listens',
          key: `${p.account_name}::ga_listens`,
        }));
      } else if (source === 'ga_site_visits') {
        const result = await api.getGASiteVisitsSummary(null);
        const programmes = result.programmes || [];
        return programmes.map(p => ({
          account_name: p.account_name,
          platform: 'ga_site_visits',
          key: `${p.account_name}::ga_site_visits`,
        }));
      } else {
        const result = await api.getAccounts({ fields: 'views' });
        const accounts = result.accounts || [];
        return accounts.map(a => ({
          account_name: a.account_name,
          platform: a.platform,
          key: `${a.account_name}::${a.platform}`,
        }));
      }
    } finally {
      setLoadingAccounts(false);
    }
  };

  const handleOpenCreateDialog = async () => {
    setShowSourcePicker(false);
    const accounts = await fetchAccountsForSource(newGroupSource);
    setDialogSource(newGroupSource);
    setDialogAccounts(accounts);
    setEditingGroup(null);
    setDialogOpen(true);
  };

  const handleOpenEditDialog = async (group) => {
    const accounts = await fetchAccountsForSource(group.source);
    setDialogSource(group.source);
    setDialogAccounts(accounts);
    setEditingGroup(group);
    setDialogOpen(true);
  };

  const handleGroupSaved = () => {
    if (onGroupsChanged) onGroupsChanged();
  };

  const handleDeleteGroup = async (id) => {
    try {
      await api.deleteAccountGroup(id);
      setDeleteGroupConfirm(null);
      if (onGroupsChanged) onGroupsChanged();
    } catch (err) {
      console.error('Fel vid borttagning av grupp:', err);
    }
  };

  const handleDeleteAllGroups = async () => {
    try {
      await api.deleteAllAccountGroups();
      setShowDeleteAllConfirm(false);
      if (onGroupsChanged) onGroupsChanged();
    } catch (err) {
      console.error('Fel vid borttagning av alla grupper:', err);
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleDateString('sv-SE');
  };

  const formatDateTime = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleDateString('sv-SE') + ' ' + date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-24">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span>Laddar databasinformation...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Database stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Databasöversikt
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <BarChart3 className="h-5 w-5 mx-auto mb-1 text-primary" />
              <p className="text-2xl font-bold">{(stats?.posts || 0).toLocaleString('sv-SE')}</p>
              <p className="text-xs text-muted-foreground">Inlägg</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <Users className="h-5 w-5 mx-auto mb-1 text-primary" />
              <p className="text-2xl font-bold">{imports.length}</p>
              <p className="text-xs text-muted-foreground">Importer</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <HardDrive className="h-5 w-5 mx-auto mb-1 text-primary" />
              <p className="text-2xl font-bold">{stats?.fileSize || '–'}</p>
              <p className="text-xs text-muted-foreground">Databasstorlek</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <Calendar className="h-5 w-5 mx-auto mb-1 text-primary" />
              <p className="text-sm font-medium">
                {stats?.earliest ? `${stats.earliest.slice(0, 10)}` : '-'}
              </p>
              <p className="text-sm font-medium">
                {stats?.latest ? `– ${stats.latest.slice(0, 10)}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">Tidsperiod</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account groups */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FolderOpen className="h-5 w-5" />
            Kontogrupper
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSourcePicker(v => !v)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Ny grupp
          </Button>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Source picker — shown when "+ Ny grupp" is clicked */}
          {showSourcePicker && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md border">
              <span className="text-sm font-medium">Källa:</span>
              {['ga_listens', 'ga_site_visits', 'posts'].map(src => (
                <label key={src} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="new-group-source"
                    value={src}
                    checked={newGroupSource === src}
                    onChange={() => setNewGroupSource(src)}
                    className="accent-primary"
                  />
                  {SOURCE_LABELS[src]}
                </label>
              ))}
              <Button
                size="sm"
                onClick={handleOpenCreateDialog}
                disabled={loadingAccounts}
                className="ml-auto"
              >
                {loadingAccounts ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : null}
                Fortsätt
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSourcePicker(false)}
              >
                Avbryt
              </Button>
            </div>
          )}

          {/* Delete-all confirmation */}
          {showDeleteAllConfirm && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Bekräfta</AlertTitle>
              <AlertDescription>
                <p className="mb-2">Ta bort alla kontogrupper? Denna åtgärd kan inte ångras.</p>
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" size="sm" onClick={() => setShowDeleteAllConfirm(false)}>Avbryt</Button>
                  <Button variant="destructive" size="sm" onClick={handleDeleteAllGroups}>Ja, rensa alla</Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Delete single group confirmation */}
          {deleteGroupConfirm !== null && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Bekräfta borttagning</AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  Ta bort gruppen &quot;{accountGroups.find(g => g.id === deleteGroupConfirm)?.name}&quot;?{' '}
                  Underliggande konton påverkas inte.
                </p>
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" size="sm" onClick={() => setDeleteGroupConfirm(null)}>Avbryt</Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDeleteGroup(deleteGroupConfirm)}>Ta bort</Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Group list */}
          {accountGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Inga grupper skapade ännu.</p>
          ) : (
            <>
              <div className="space-y-2">
                {accountGroups.map(group => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between p-3 rounded-md border bg-muted/30"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{group.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          group.source === 'ga_listens'
                            ? 'bg-green-100 text-green-800'
                            : group.source === 'ga_site_visits'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                        }`}>
                          {SOURCE_LABELS[group.source]}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {group.members.length} konton
                        {group.created_at ? ` · Skapad ${formatDate(group.created_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenEditDialog(group)}
                        disabled={loadingAccounts}
                        title="Redigera"
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        Redigera
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteGroupConfirm(group.id)}
                        title="Ta bort grupp"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive"
                onClick={() => setShowDeleteAllConfirm(true)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Rensa alla grupper
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Coverage map */}
      {coverage && coverage.months && coverage.months.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Månadsöversikt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {coverage.months.map(m => (
                <div
                  key={m.month}
                  className={`px-3 py-1.5 rounded text-sm font-medium border ${
                    m.has_facebook && m.has_instagram
                      ? 'bg-purple-100 border-purple-300 text-purple-800'
                      : m.has_facebook
                      ? 'bg-blue-100 border-blue-300 text-blue-800'
                      : 'bg-pink-100 border-pink-300 text-pink-800'
                  }`}
                  title={`${m.post_count} inlägg`}
                >
                  {m.month} ({m.post_count})
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Open account gaps — accounts that are normally present but missing from the imports */}
      {openGaps.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Öppna luckor
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* View mode: per account (default) vs per month, for re-export planning */}
              <div className="inline-flex rounded-md border overflow-hidden">
                {[
                  { value: 'account', label: 'Per konto' },
                  { value: 'month', label: 'Per månad' },
                ].map((opt, i) => (
                  <button
                    key={opt.value}
                    onClick={() => setGapsViewMode(opt.value)}
                    className={`px-3 py-1.5 text-sm transition-colors ${i > 0 ? 'border-l' : ''} ${
                      gapsViewMode === opt.value
                        ? 'bg-blue-50 text-blue-800 font-medium'
                        : 'bg-white text-muted-foreground hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {gapsViewMode === 'account' && (
                <>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Sortera efter</span>
                  <Select value={gapsSortMode} onValueChange={setGapsSortMode}>
                    <SelectTrigger className="w-56 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(GAPS_SORT_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {gapsViewMode === 'account' ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Konton som brukar finnas med i importerna men som saknas för en
                  eller flera månader. Räckvidden kan ändå finnas kvar via Metas
                  API — det är inläggsstatistiken som saknas här.
                </p>
                <div className="space-y-2">
                  {sortedOpenGaps.map(g => {
                    const key = `${g.account_name}::${g.platform}`;
                    const showReach = gapsSortMode === 'reach';
                    const reachIncomplete = showReach && g.gap_reach_known < g.months.length;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-3 p-3 rounded-md border bg-amber-50 border-amber-200 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate flex items-center gap-1.5">
                            {g.account_name}
                            <PlatformBadge platform={g.platform} />
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Saknas: {g.months.join(', ')}
                          </p>
                          {showReach && (
                            <p className="text-xs text-muted-foreground">
                              Räckvidd i luckorna: {reachIncomplete ? '≥' : ''}
                              {(g.gap_reach || 0).toLocaleString('sv-SE')}
                              {reachIncomplete && (
                                <span> (varav {g.gap_reach_known} av {g.months.length} månader har räckviddsdata)</span>
                              )}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-shrink-0"
                          disabled={retiringGapKey === key}
                          onClick={() => handleRetireGapAccount(g.account_name, g.platform)}
                        >
                          {retiringGapKey === key
                            ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                            : <EyeOff className="w-3 h-3 mr-1" />}
                          Används inte längre
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Månad för månad: vilka konton som ska väljas när samma månad
                  om-exporteras från Meta Business Suite.
                </p>
                <div className="space-y-2">
                  {gapsByMonth.map(m => (
                    <div
                      key={m.month}
                      className="p-3 rounded-md border bg-amber-50 border-amber-200 text-sm"
                    >
                      <p className="font-medium">
                        {m.month}
                        <span className="text-xs text-muted-foreground font-normal ml-1.5">
                          ({m.accounts.length} {m.accounts.length === 1 ? 'konto' : 'konton'})
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {m.accounts.map((a, i) => (
                          <React.Fragment key={`${a.account_name}::${a.platform}`}>
                            {i > 0 && ', '}
                            {a.account_name}
                          </React.Fragment>
                        ))}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground pt-1 border-t">
              Vill du komplettera en lucka: exportera hela riks- eller
              lokaltgruppen från Meta Business Suite, inte en enskild sida.
              En enskild-sida-export har gett dagsuppdelad statistik i stället
              för en inläggsexport, vilket ger felaktig data.
            </p>
          </CardContent>
        </Card>
      )}

      {/* FB unique viewers data */}
      {viewersMonths.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Unika tittare (Facebook API)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {viewersMonths.map(month => (
                <div key={month} className="flex items-center gap-1 px-3 py-1.5 rounded border bg-blue-50 border-blue-200 text-blue-800 text-sm font-medium">
                  {month}
                  <button
                    onClick={() => {
                      if (confirm(`Radera Unika tittare-data för ${month}?`)) {
                        api.deleteViewersMonth(month).then(fetchData);
                      }
                    }}
                    className="ml-1 hover:text-red-600"
                    title="Radera"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Unika konton som såg sidans innehåll minst en gång under månaden (Metas
              nya mått, ersätter Kontoräckvidd sedan juni 2026). Gäller bara Facebook.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Legacy reach data */}
      {reachMonths.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Kontoräckvidd (Facebook API) — äldre mått</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {reachMonths.map(month => (
                <div key={month} className="flex items-center gap-1 px-3 py-1.5 rounded border bg-amber-50 border-amber-200 text-amber-800 text-sm font-medium">
                  {month}
                  <button
                    onClick={() => {
                      if (confirm(`Radera räckviddsdata för ${month}?`)) {
                        api.deleteReachMonth(month).then(fetchData);
                      }
                    }}
                    className="ml-1 hover:text-red-600"
                    title="Radera"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Äldre räckviddsmått — avvecklat av Meta i juni 2026 och ersatt av Unika
              tittare. Historiken behålls som den är; värdena är inte jämförbara med
              Unika tittare eftersom måtten definieras olika.
            </p>
          </CardContent>
        </Card>
      )}

      {/* IG Reach data */}
      {igReachMonths.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Kontoräckvidd (Instagram API)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {igReachMonths.map(month => (
                <div key={month} className="flex items-center gap-1 px-3 py-1.5 rounded border bg-pink-50 border-pink-200 text-pink-800 text-sm font-medium">
                  {month}
                  <button
                    onClick={() => {
                      if (confirm(`Radera IG-räckviddsdata för ${month}?`)) {
                        api.deleteIGReachMonth(month).then(fetchData);
                      }
                    }}
                    className="ml-1 hover:text-red-600"
                    title="Radera"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Räckviddsdata importerad från Metas Graph API. Gäller bara Instagram.
              OBS: API-uttag täcker max 30 dagar — 31-dagarsmånader kan vara ~1 % lägre.
            </p>
          </CardContent>
        </Card>
      )}

      {/* GA Listens data — shown when at least one month of GA data exists */}
      {gaListensMonths.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Lyssningar (Google Analytics)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {gaListensMonths.map(month => (
                <div key={month} className="flex items-center gap-1 px-3 py-1.5 rounded border bg-green-50 border-green-200 text-green-800 text-sm font-medium">
                  {month}
                  <button
                    onClick={() => {
                      if (confirm(`Radera GA-lyssningsdata för ${month}?`)) {
                        api.deleteGAListensMonth(month).then(fetchData);
                      }
                    }}
                    className="ml-1 hover:text-red-600"
                    title="Radera"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Lyssningsdata från Google Analytics (Facebook-trafik, lyssnat ≥5 sekunder).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Import list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg">Importer</CardTitle>
          <div className="flex space-x-2">
            <Button size="sm" variant="outline" onClick={fetchData} title="Uppdatera">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={handleVacuum} disabled={vacuuming} title="Optimera databasen">
              {vacuuming ? <RefreshCw className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
              <span className="ml-1 hidden sm:inline">Optimera</span>
            </Button>
            <a href={api.getFlatExportUrl()} download>
              <Button size="sm" variant="outline" title="Ladda ner en Excel-fil med färdiga siffror per konto och månad – för Power BI eller egen analys">
                <FileSpreadsheet className="w-4 h-4" />
                <span className="ml-1 hidden sm:inline">Exportera för analys (.xlsx)</span>
              </Button>
            </a>
            <a href={api.getBackupUrl()} download>
              <Button size="sm" variant="outline" title="Ladda ner databasbackup">
                <Download className="w-4 h-4" />
                <span className="ml-1 hidden sm:inline">Backup</span>
              </Button>
            </a>
          </div>
        </CardHeader>

        <CardContent>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            <span className="font-medium text-foreground">Exportera för analys</span> laddar
            ner <span className="font-medium text-foreground">ALL data</span> som en Excel-fil
            (.xlsx) för t.ex. Power BI — hela historiken, alla konton och grupper, en flik per
            datakälla med färdigberäknade värden (snitt/dag, gruppsummeringar, uppskattade unika
            klickare). Exporten{' '}
            <span className="font-medium text-foreground">påverkas inte av periodvalet</span> i
            vyerna; tidsfiltrering gör du i analysverktyget. Fliken <code>_LÄS_MIG</code> i filen
            förklarar modellen.
          </p>
          {deleteConfirm !== null && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Bekräfta borttagning</AlertTitle>
              <AlertDescription>
                <p className="mb-2">Är du säker? Alla inlägg från denna import raderas permanent.</p>
                <div className="flex space-x-2 mt-2">
                  <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Avbryt</Button>
                  <Button variant="destructive" onClick={() => handleDeleteImport(deleteConfirm)}>Ja, radera</Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {imports.length === 0 ? (
            <div className="text-center text-muted-foreground p-4">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>Inga importer har gjorts ännu.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filnamn</TableHead>
                    <TableHead>Månad</TableHead>
                    <TableHead>Importerad</TableHead>
                    <TableHead className="text-right">Rader</TableHead>
                    <TableHead className="text-right">Konton</TableHead>
                    <TableHead className="text-right">Åtgärder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map(imp => (
                    <TableRow key={imp.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center">
                          <FileText className="w-4 h-4 mr-2 text-primary shrink-0" />
                          <span className="truncate max-w-[200px]" title={imp.filename}>
                            {imp.filename}
                          </span>
                          <PlatformBadge platform={imp.platform} />
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center text-muted-foreground">
                          <Calendar className="w-3 h-3 mr-1" />
                          {imp.month || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{formatDateTime(imp.imported_at)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end">
                          <BarChart3 className="w-3 h-3 mr-1 text-muted-foreground" />
                          {(imp.row_count || 0).toLocaleString('sv-SE')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end">
                          <Users className="w-3 h-3 mr-1 text-muted-foreground" />
                          {(imp.account_count || 0).toLocaleString('sv-SE')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm(imp.id)}
                          title="Ta bort import"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hidden accounts management */}
      <HiddenAccountsManager onImportsChanged={onImportsChanged} />

      {/* Group create/edit dialog */}
      <GroupCreateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        source={dialogSource}
        availableAccounts={dialogAccounts}
        editGroup={editingGroup}
        onSave={handleGroupSaved}
      />
    </div>
  );
};

export default ImportManager;
