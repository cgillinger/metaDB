import React, { useMemo } from 'react';
import { Calendar, SlidersHorizontal } from 'lucide-react';

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

const PeriodSelector = ({
  availableMonths,
  selectedMonths,
  onMonthsChange,
  customRange,
  onCustomRangeChange,
  mode,
  onModeChange,
}) => {
  // All available month keys sorted chronologically
  const sortedAvailableKeys = useMemo(() => {
    return [...availableMonths].sort((a, b) => a.month.localeCompare(b.month)).map(m => m.month);
  }, [availableMonths]);

  // Map of month key → monthData for quick lookup
  const availableMap = useMemo(() => {
    return new Map(availableMonths.map(m => [m.month, m]));
  }, [availableMonths]);

  // Group available months by year (for display)
  const monthsByYear = useMemo(() => {
    const groups = {};
    for (const m of availableMonths) {
      const year = m.month.slice(0, 4);
      if (!groups[year]) groups[year] = [];
      groups[year].push(m);
    }
    // Sort months within each year
    for (const year of Object.keys(groups)) {
      groups[year].sort((a, b) => a.month.localeCompare(b.month));
    }
    return groups;
  }, [availableMonths]);

  const years = useMemo(() => Object.keys(monthsByYear).sort(), [monthsByYear]);

  // Selected month keys as a sorted set
  const selectedSet = useMemo(() => new Set(selectedMonths), [selectedMonths]);
  const sortedSelected = useMemo(() => [...selectedMonths].sort(), [selectedMonths]);

  const handleMonthClick = (monthKey) => {
    if (!availableMap.has(monthKey)) return;

    const isSelected = selectedSet.has(monthKey);

    if (isSelected) {
      if (sortedSelected.length === 1) return; // must keep at least one
      const min = sortedSelected[0];
      const max = sortedSelected[sortedSelected.length - 1];
      const isAtEnd = monthKey === min || monthKey === max;
      if (isAtEnd) {
        // Shrink from end
        onMonthsChange(sortedSelected.filter(m => m !== monthKey));
      } else {
        // Middle month clicked — reset to just this month
        onMonthsChange([monthKey]);
      }
    } else {
      if (sortedSelected.length === 0) {
        onMonthsChange([monthKey]);
        return;
      }
      const min = sortedSelected[0];
      const max = sortedSelected[sortedSelected.length - 1];

      // Check adjacency in the sorted available months list
      const clickedIdx = sortedAvailableKeys.indexOf(monthKey);
      const minIdx = sortedAvailableKeys.indexOf(min);
      const maxIdx = sortedAvailableKeys.indexOf(max);

      // Adjacent means directly next to current range in the available months sequence
      const isAdjacentBefore = clickedIdx === minIdx - 1;
      const isAdjacentAfter = clickedIdx === maxIdx + 1;

      if (isAdjacentBefore || isAdjacentAfter) {
        // Extend selection to include all available months in the new range
        const newMin = isAdjacentBefore ? clickedIdx : minIdx;
        const newMax = isAdjacentAfter ? clickedIdx : maxIdx;
        const newSelection = sortedAvailableKeys.slice(newMin, newMax + 1);
        onMonthsChange(newSelection);
      } else {
        // Non-adjacent — start fresh
        onMonthsChange([monthKey]);
      }
    }
  };

  const getActiveClass = (monthKey) => {
    const d = availableMap.get(monthKey);
    if (!d) return 'bg-primary text-primary-foreground';
    if (d.has_facebook && d.has_instagram) return 'bg-purple-600 text-white';
    if (d.has_instagram) return 'bg-pink-600 text-white';
    if (d.has_facebook) return 'bg-blue-600 text-white';
    return 'bg-primary text-primary-foreground';
  };

  if (!availableMonths || availableMonths.length === 0) return null;

  return (
    <div className="bg-white border border-border rounded-lg p-4 space-y-3">
      {/* Header row: icon + mode toggle */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Calendar className="h-4 w-4" />
          Period
        </div>

        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          <button
            onClick={() => onModeChange('months')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              mode === 'months'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white text-muted-foreground hover:bg-muted/50'
            }`}
          >
            Månader
          </button>
          <button
            onClick={() => onModeChange('custom')}
            className={`px-3 py-1.5 font-medium transition-colors border-l border-border ${
              mode === 'custom'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 inline mr-1" />
            Anpassad
          </button>
        </div>
      </div>

      {/* Month mode */}
      {mode === 'months' && (
        <div className="space-y-2">
          {years.map(year => (
            <div key={year} className="space-y-1">
              {years.length > 1 && (
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{year}</div>
              )}
              <div className="flex flex-wrap gap-2">
                {monthsByYear[year].map(monthData => {
                  const monthKey = monthData.month;
                  const monthNum = parseInt(monthKey.slice(5, 7), 10);
                  const name = MONTH_NAMES_SV[monthNum - 1];
                  const isSelected = selectedSet.has(monthKey);

                  return (
                    <button
                      key={monthKey}
                      onClick={() => handleMonthClick(monthKey)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        isSelected
                          ? `${getActiveClass(monthKey)} border-transparent`
                          : 'bg-white text-gray-600 border-gray-300 hover:border-primary/60 hover:bg-gray-50'
                      }`}
                    >
                      <span className="block">{name}</span>
                      <span className={`block text-xs ${isSelected ? 'opacity-80' : 'text-gray-400'}`}>
                        {monthData.post_count.toLocaleString('sv-SE')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom date range */}
      {mode === 'custom' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Från:</label>
            <input
              type="date"
              value={customRange?.from || ''}
              onChange={(e) => onCustomRangeChange({ from: e.target.value, to: customRange?.to || '' })}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Till:</label>
            <input
              type="date"
              value={customRange?.to || ''}
              onChange={(e) => onCustomRangeChange({ from: customRange?.from || '', to: e.target.value })}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PeriodSelector;
