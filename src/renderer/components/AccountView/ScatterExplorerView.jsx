/**
 * ScatterExplorerView — fristående ingång till räckvidd-scatter per konto.
 *
 * Når man via knappen "Gå till scatterdiagram för räckvidd" i värde-panelen
 * (eller som genväg via radklick i kontotabellen). Här väljer man konto i en
 * sökbar lista i stället för att först behöva sätta ett tabellvärde.
 *
 * Plattformslogik: listan fylls från /api/accounts för vald plattform. När
 * "Alla" är valt (apiPlatform = undefined) listas både FB- och IG-konton, var
 * och en med plattformsbadge. Själva golv-/viral-beräkningen i AccountDetailView
 * använder det valda kontots EGEN plattform.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import PlatformBadge from '../ui/PlatformBadge';
import ProfileIcon from '../ui/ProfileIcon';
import { ArrowLeft, ChevronDown, Search } from 'lucide-react';
import { api } from '@/utils/apiClient';
import AccountDetailView from './AccountDetailView';

const accountKey = (a) => `${a.account_name}::${a.platform}`;

const ScatterExplorerView = ({ apiPlatform, periodParams = {}, initialAccount = null, onBack }) => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(initialAccount);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Hämta kontolistan (konton med inlägg) för vald plattform/period.
  useEffect(() => {
    let cancelled = false;
    const fetchAccounts = async () => {
      setLoading(true);
      setError(false);
      try {
        const params = { ...periodParams, fields: 'reach' };
        if (apiPlatform) params.platform = apiPlatform;
        const data = await api.getAccounts(params);
        if (cancelled) return;
        const list = (data.accounts || [])
          .filter(a => a.account_name && a.platform)
          .sort((a, b) => (b.reach || 0) - (a.reach || 0));
        setAccounts(list);
      } catch (err) {
        if (!cancelled) {
          console.error('Fel vid hämtning av konton för scatter:', err);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAccounts();
    return () => { cancelled = true; };
  }, [apiPlatform, periodParams]);

  // Nollställ valt konto om det inte längre finns i listan (t.ex. plattformsbyte).
  useEffect(() => {
    if (selected && accounts.length > 0 &&
        !accounts.some(a => accountKey(a) === accountKey(selected))) {
      setSelected(null);
    }
    // selected medvetet utelämnad ur deps för att undvika loop.
  }, [accounts]);

  // Stäng listan vid klick utanför.
  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(a => a.account_name.toLowerCase().includes(q));
  }, [accounts, query]);

  const handlePick = (a) => {
    setSelected(a);
    setOpen(false);
    setQuery('');
  };

  const picker = (
    <div className="relative w-full max-w-md" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full rounded-md border bg-white px-3 py-2 text-sm hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 truncate">
          {selected ? (
            <>
              <ProfileIcon accountName={selected.account_name} size="sm" />
              <span className="truncate font-medium">{selected.account_name}</span>
              <PlatformBadge platform={selected.platform} />
            </>
          ) : (
            <span className="text-muted-foreground">Välj konto…</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b px-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Sök konto…"
              className="w-full py-2 text-sm outline-none bg-transparent"
            />
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Inga konton</div>
            ) : filtered.map(a => (
              <button
                key={accountKey(a)}
                onClick={() => handlePick(a)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm hover:bg-muted/60"
              >
                <ProfileIcon accountName={a.account_name} size="sm" />
                <span className="truncate flex-1">{a.account_name}</span>
                <PlatformBadge platform={a.platform} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Card className="p-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <Button variant="outline" size="sm" onClick={onBack} className="shrink-0 w-fit">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Tillbaka
        </Button>
        {picker}
      </div>

      {loading && (
        <p className="text-center text-muted-foreground py-12">Laddar konton…</p>
      )}
      {error && !loading && (
        <p className="text-center text-muted-foreground py-12">Kunde inte hämta konton.</p>
      )}
      {!loading && !error && !selected && (
        <p className="text-center text-muted-foreground py-12">
          Välj ett konto ovan för att se räckvidd per inlägg.
        </p>
      )}
      {!loading && !error && selected && (
        <AccountDetailView
          account={selected}
          platform={selected.platform}
          periodParams={periodParams}
          showHeader={false}
        />
      )}
    </Card>
  );
};

export default ScatterExplorerView;
