import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { EyeOff, Eye, AlertCircle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/utils/apiClient';

const PLATFORM_LABELS = {
  facebook: { label: 'Facebook', className: 'bg-blue-100 text-blue-800' },
  instagram: { label: 'Instagram', className: 'bg-pink-100 text-pink-800' },
  ga_listens: { label: 'GA-lyssningar', className: 'bg-green-100 text-green-800' },
  ga_site_visits: { label: 'GA-sajtbesök', className: 'bg-green-100 text-green-800' },
};

const PlatformBadge = ({ platform }) => {
  const cfg = PLATFORM_LABELS[platform] || { label: platform, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded ${cfg.className}`}>
      {cfg.label}
    </span>
  );
};

const HiddenAccountsManager = ({ onImportsChanged }) => {
  const [visible, setVisible] = useState([]);   // { account_name, platform, post_count }
  const [hidden, setHidden] = useState([]);     // { account_name, platform, hidden_at }
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set()); // keys of selected visible rows
  const [confirmHide, setConfirmHide] = useState(null); // { account_name, platform } | 'bulk'
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const makeKey = (name, platform) => `${name}::${platform}`;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [accountsRes, hiddenRes, gaRes, gsvRes] = await Promise.all([
        api.getAccounts({ fields: 'post_count' }),
        api.getHiddenAccounts(),
        api.getGAListensSummary(null, 'desc'),
        api.getGASiteVisitsSummary(null, 'desc'),
      ]);

      const hiddenKeys = new Set(
        (hiddenRes.accounts || []).map(h => makeKey(h.account_name, h.platform))
      );

      const gaAccounts = (gaRes.programmes || []).map(p => ({
        account_name: p.account_name,
        platform: 'ga_listens',
        post_count: p.total_listens,
      }));

      const gsvAccounts = (gsvRes.programmes || []).map(p => ({
        account_name: p.account_name,
        platform: 'ga_site_visits',
        post_count: p.total_visits,
      }));

      const allAccounts = [...(accountsRes.accounts || []), ...gaAccounts, ...gsvAccounts];
      const visibleAccounts = allAccounts.filter(
        a => !hiddenKeys.has(makeKey(a.account_name, a.platform))
      );

      setVisible(visibleAccounts);
      setHidden(hiddenRes.accounts || []);
    } catch (err) {
      console.error('Fel vid hämtning av kontodata:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleSelect = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === visible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map(a => makeKey(a.account_name, a.platform))));
    }
  };

  const doHide = async (accountName, platform) => {
    setBusy(true);
    try {
      await api.hideAccount(accountName, platform);
      await fetchData();
      if (onImportsChanged) onImportsChanged();
    } catch (err) {
      console.error('Fel vid döljning:', err);
    } finally {
      setBusy(false);
      setConfirmHide(null);
    }
  };

  const doHideBulk = async () => {
    setBusy(true);
    try {
      const toHide = visible.filter(a => selected.has(makeKey(a.account_name, a.platform)));
      await Promise.all(toHide.map(a => api.hideAccount(a.account_name, a.platform)));
      setSelected(new Set());
      await fetchData();
      if (onImportsChanged) onImportsChanged();
    } catch (err) {
      console.error('Fel vid bulk-döljning:', err);
    } finally {
      setBusy(false);
      setConfirmHide(null);
    }
  };

  const doUnhide = async (accountName, platform) => {
    setBusy(true);
    try {
      await api.unhideAccount(accountName, platform);
      await fetchData();
      if (onImportsChanged) onImportsChanged();
    } catch (err) {
      console.error('Fel vid återställning:', err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-16">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            <span className="text-sm">Laddar konton...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <EyeOff className="h-5 w-5" />
          Hantera konton
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Dolda konton filtreras bort från alla vyer. Data raderas inte.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Confirm single hide */}
        {confirmHide && confirmHide !== 'bulk' && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Dölj konto</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Kontot <strong>{confirmHide.account_name}</strong> döljs från alla vyer.
                Data raderas inte.
              </p>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmHide(null)}>
                  Avbryt
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => doHide(confirmHide.account_name, confirmHide.platform)}
                >
                  Dölj
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Visible accounts table */}
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Inga synliga konton.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={selected.size === visible.length && visible.length > 0}
                      onChange={toggleSelectAll}
                      title="Markera alla"
                    />
                  </TableHead>
                  <TableHead>Konto</TableHead>
                  <TableHead>Plattform</TableHead>
                  <TableHead className="text-right">Poster</TableHead>
                  <TableHead className="text-right">Åtgärd</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(account => {
                  const key = makeKey(account.account_name, account.platform);
                  return (
                    <TableRow key={key} className={selected.has(key) ? 'bg-muted/40' : ''}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={selected.has(key)}
                          onChange={() => toggleSelect(key)}
                        />
                      </TableCell>
                      <TableCell className="font-medium text-sm">{account.account_name}</TableCell>
                      <TableCell>
                        <PlatformBadge platform={account.platform} />
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {(account.post_count ?? 0).toLocaleString('sv-SE')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setConfirmHide({ account_name: account.account_name, platform: account.platform })}
                          title="Dölj konto"
                        >
                          <EyeOff className="w-3.5 h-3.5 mr-1" />
                          Dölj
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Hidden accounts — collapsible */}
        {hidden.length > 0 && (
          <div className="border rounded-md">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setHiddenExpanded(v => !v)}
            >
              <span>Dolda konton ({hidden.length} st)</span>
              {hiddenExpanded
                ? <ChevronDown className="w-4 h-4" />
                : <ChevronRight className="w-4 h-4" />
              }
            </button>

            {hiddenExpanded && (
              <div className="border-t overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Konto</TableHead>
                      <TableHead>Plattform</TableHead>
                      <TableHead>Dolt sedan</TableHead>
                      <TableHead className="text-right">Åtgärd</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hidden.map(h => (
                      <TableRow key={makeKey(h.account_name, h.platform)} className="opacity-60">
                        <TableCell className="font-medium text-sm">{h.account_name}</TableCell>
                        <TableCell>
                          <PlatformBadge platform={h.platform} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {h.hidden_at ? new Date(h.hidden_at).toLocaleDateString('sv-SE') : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => doUnhide(h.account_name, h.platform)}
                            title="Visa konto igen"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            Visa
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>

    {/* Sticky bulk action bar — visible when ≥1 row is selected */}
    {selected.size > 0 && (
      <div className="sticky bottom-0 z-20 bg-background border-t shadow-[0_-2px_8px_rgba(0,0,0,0.10)] px-4 py-3">
        {confirmHide === 'bulk' ? (
          /* Confirmation state */
          <div className="flex flex-wrap items-center gap-3">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            <span className="text-sm">
              <strong>{selected.size} konton</strong> döljs från alla vyer. Data raderas inte.
            </span>
            <div className="flex gap-2 ml-auto">
              <Button size="sm" variant="outline" onClick={() => setConfirmHide(null)}>
                Avbryt
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={doHideBulk}>
                {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Bekräfta
              </Button>
            </div>
          </div>
        ) : (
          /* Default state */
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{selected.size} valda</span>
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto"
              onClick={() => setConfirmHide('bulk')}
            >
              <EyeOff className="w-3.5 h-3.5 mr-1" />
              Dölj valda ({selected.size} st)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Avmarkera
            </Button>
          </div>
        )}
      </div>
    )}
    </>
  );
};

export default HiddenAccountsManager;
