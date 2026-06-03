import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { BarChart3, Users } from 'lucide-react';
import { api } from '@/utils/apiClient';
import { COMPARISONS, DEFAULT_COMPARISON } from './comparisonConfig';
import ComparisonChart from './ComparisonChart';

const ComparisonView = ({ periodParams = {}, accountGroups = [], onGroupsChanged = null }) => {
  const [comparisonType, setComparisonType] = useState(DEFAULT_COMPARISON);
  const [accounts, setAccounts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [data, setData] = useState([]);
  const [matchInfo, setMatchInfo] = useState(null);
  const [dualAxis, setDualAxis] = useState(false);
  const [loading, setLoading] = useState(false);

  // Refetch accounts/groups whenever the parent's accountGroups list changes
  // (e.g. user creates/edits a group in the Databas tab).
  useEffect(() => {
    api.getComparisonAccounts()
      .then(res => {
        const list = res.accounts || [];
        const grps = res.groups || [];
        setAccounts(list);
        setGroups(grps);
        setSelectedAccount(prev => {
          if (prev) {
            if (prev.startsWith('__group__')) {
              const id = parseInt(prev.replace('__group__', ''), 10);
              if (grps.some(g => g.id === id)) return prev;
            } else if (list.includes(prev)) {
              return prev;
            }
          }
          if (grps.length > 0) return `__group__${grps[0].id}`;
          if (list.length > 0) return list[0];
          return '';
        });
      })
      .catch(err => console.error('Fel vid hämtning av jämförelsekonton:', err));
  }, [accountGroups]);

  const activeConfig = useMemo(
    () => COMPARISONS.find(c => c.id === comparisonType) || COMPARISONS[0],
    [comparisonType]
  );

  useEffect(() => {
    if (!selectedAccount) return;
    const months = periodParams.months
      ? periodParams.months.split(',').map(m => m.trim()).filter(Boolean)
      : null;
    setLoading(true);
    setMatchInfo(null);

    if (selectedAccount.startsWith('__group__')) {
      const groupId = parseInt(selectedAccount.replace('__group__', ''), 10);
      const group = groups.find(g => g.id === groupId);
      if (!group) {
        setData([]);
        setLoading(false);
        return;
      }
      api.getComparisonBesokLankklickGroup(group.memberGaNames, months)
        .then(res => {
          setData(res.data || []);
          setMatchInfo(res.matchInfo || null);
        })
        .catch(err => console.error('Fel vid hämtning av jämförelsedata:', err))
        .finally(() => setLoading(false));
    } else {
      api[activeConfig.fetchMethod](selectedAccount, months)
        .then(res => setData(res.data || []))
        .catch(err => console.error('Fel vid hämtning av jämförelsedata:', err))
        .finally(() => setLoading(false));
    }
  }, [selectedAccount, comparisonType, activeConfig, periodParams, groups]);

  const isGroupSelected = selectedAccount.startsWith('__group__');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Jämförelser
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-4 mb-6">
          {COMPARISONS.length > 1 && (
            <div>
              <Label className="mb-1 block">Typ</Label>
              <Select value={comparisonType} onValueChange={setComparisonType}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARISONS.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="mb-1 block">Konto</Label>
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Välj konto..." />
              </SelectTrigger>
              <SelectContent>
                {groups.map(g => (
                  <SelectItem key={`__group__${g.id}`} value={`__group__${g.id}`}>
                    <span className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-blue-600" />
                      {g.name}
                      <span className="text-xs text-muted-foreground ml-1">
                        {g.matchedCount}/{g.memberCount}
                      </span>
                    </span>
                  </SelectItem>
                ))}
                {groups.length > 0 && accounts.length > 0 && <SelectSeparator />}
                {accounts.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant={dualAxis ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDualAxis(!dualAxis)}
          >
            {dualAxis ? 'Gemensam skala' : 'Separata axlar'}
          </Button>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Laddar...</p>}

        {!loading && data.length > 0 && (
          <ComparisonChart
            data={data}
            seriesAConfig={activeConfig.seriesA}
            seriesBConfig={activeConfig.seriesB}
            dualAxis={dualAxis}
          />
        )}

        {!loading && data.length === 0 && selectedAccount && (
          <p className="text-muted-foreground text-sm">Ingen data tillgänglig för detta konto.</p>
        )}

        {matchInfo && matchInfo.matched < matchInfo.total && (
          <p className="text-xs text-amber-600 mt-2">
            ⚠ {matchInfo.matched} av {matchInfo.total} konton i gruppen har matchande Meta-konto.
            GA-besök aggregeras för alla {matchInfo.total} konton, men länkklick bara för de {matchInfo.matched} matchade.
          </p>
        )}

        {activeConfig.disclaimer && (
          <p className="text-xs text-muted-foreground mt-4 italic">
            {activeConfig.disclaimer}
            {isGroupSelected && (
              <> Gruppen aggregerar värden genom att summera alla medlemmars besök respektive länkklick per månad.</>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default ComparisonView;
