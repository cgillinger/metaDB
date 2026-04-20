import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import { BarChart3 } from 'lucide-react';
import { api } from '@/utils/apiClient';
import { COMPARISONS, DEFAULT_COMPARISON } from './comparisonConfig';
import ComparisonChart from './ComparisonChart';

const ComparisonView = ({ periodParams = {} }) => {
  const [comparisonType, setComparisonType] = useState(DEFAULT_COMPARISON);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [data, setData] = useState([]);
  const [dualAxis, setDualAxis] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getComparisonAccounts()
      .then(res => {
        const list = res.accounts || [];
        setAccounts(list);
        if (list.length > 0) setSelectedAccount(list[0]);
      })
      .catch(err => console.error('Fel vid hämtning av jämförelsekonton:', err));
  }, []);

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
    api[activeConfig.fetchMethod](selectedAccount, months)
      .then(res => setData(res.data || []))
      .catch(err => console.error('Fel vid hämtning av jämförelsedata:', err))
      .finally(() => setLoading(false));
  }, [selectedAccount, comparisonType, activeConfig, periodParams]);

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
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Välj konto..." />
              </SelectTrigger>
              <SelectContent>
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

        {activeConfig.disclaimer && (
          <p className="text-xs text-muted-foreground mt-4 italic">
            {activeConfig.disclaimer}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default ComparisonView;
