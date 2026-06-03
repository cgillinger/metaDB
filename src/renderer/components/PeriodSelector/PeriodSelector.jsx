/**
 * PeriodSelector — interactive month-picker with collapsible year groups.
 *
 * @param {Object} props
 * @param {Array}    props.availableMonths  - Coverage data from API
 * @param {string[]} props.selectedMonths   - Currently selected YYYY-MM keys
 * @param {Function} props.onMonthsChange   - Callback when month selection changes
 * @param {Object}   props.customRange      - { from: string, to: string } date range
 * @param {Function} props.onCustomRangeChange - Callback when custom range changes
 * @param {'months'|'custom'} props.mode    - Active period mode
 * @param {Function} props.onModeChange     - Callback when mode toggles
 * @param {boolean}  [props.allowCustom=true] - Whether to show the custom date range option.
 *        Set to false when the active data source only supports monthly granularity
 *        (e.g. GA listens, account reach). Prevents misleading UX where the user
 *        picks a date range that the backend cannot honour.
 */
import React, { useMemo, useState } from 'react';
import { Calendar, SlidersHorizontal, ChevronRight } from 'lucide-react';

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
  allowCustom = true,
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
    for (const year of Object.keys(groups)) {
      groups[year].sort((a, b) => a.month.localeCompare(b.month));
    }
    return groups;
  }, [availableMonths]);

  const years = useMemo(() => Object.keys(monthsByYear).sort(), [monthsByYear]);
  const latestYear = years[years.length - 1];

  // Track which years are expanded. Latest year is always expanded by default.
  const [expandedYears, setExpandedYears] = useState(new Set());

  const isYearExpanded = (year) => {
    if (year === latestYear) return true;
    // Also expand if any month in this year is selected
    const yearMonths = monthsByYear[year] || [];
    if (yearMonths.some(m => selectedMonths.includes(m.month))) return true;
    return expandedYears.has(year);
  };

  const toggleYear = (year) => {
    if (year === latestYear) return; // Latest year always stays open
    setExpandedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

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
        onMonthsChange(sortedSelected.filter(m => m !== monthKey));
      } else {
        onMonthsChange([monthKey]);
      }
    } else {
      if (sortedSelected.length === 0) {
        onMonthsChange([monthKey]);
        return;
      }
      const min = sortedSelected[0];
      const max = sortedSelected[sortedSelected.length - 1];

      const clickedIdx = sortedAvailableKeys.indexOf(monthKey);
      const minIdx = sortedAvailableKeys.indexOf(min);
      const maxIdx = sortedAvailableKeys.indexOf(max);

      const isAdjacentBefore = clickedIdx === minIdx - 1;
      const isAdjacentAfter = clickedIdx === maxIdx + 1;

      if (isAdjacentBefore || isAdjacentAfter) {
        const newMin = isAdjacentBefore ? clickedIdx : minIdx;
        const newMax = isAdjacentAfter ? clickedIdx : maxIdx;
        const newSelection = sortedAvailableKeys.slice(newMin, newMax + 1);
        onMonthsChange(newSelection);
      } else {
        const newMin = Math.min(clickedIdx, minIdx);
        const newMax = Math.max(clickedIdx, maxIdx);
        const newSelection = sortedAvailableKeys.slice(newMin, newMax + 1);
        onMonthsChange(newSelection);
      }
    }
  };

  const getActiveClass = (monthKey) => {
    const d = availableMap.get(monthKey);
    if (!d) return 'bg-primary text-primary-foreground';
    if (d.has_facebook && d.has_instagram) return 'bg-purple-600 text-white';
    if (d.has_instagram) return 'bg-pink-600 text-white';
    if (d.has_facebook) return 'bg-blue-600 text-white';
    if (d.has_ga_listens) return 'bg-green-600 text-white'; // GA-only month
    return 'bg-primary text-primary-foreground';
  };

  // Summary text for a collapsed year
  const getYearSummary = (year) => {
    const months = monthsByYear[year] || [];
    const totalPosts = months.reduce((s, m) => s + m.post_count, 0);
    const reachCount = months.filter(m => m.has_reach).length;
    const parts = [];
    if (totalPosts > 0) parts.push(`${totalPosts.toLocaleString('sv-SE')} inlägg`);
    if (reachCount > 0) parts.push(`${months.length} mån räckvidd`);
    if (parts.length === 0) parts.push(`${months.length} månader`);
    return parts.join(', ');
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
          {allowCustom && (
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
          )}
        </div>
      </div>

      {/* Month mode */}
      {mode === 'months' && (
        <div className="space-y-2">
          {years.map(year => {
            const expanded = isYearExpanded(year);
            const isLatest = year === latestYear;

            return (
              <div key={year} className="space-y-1">
                {years.length > 1 && (
                  <button
                    onClick={() => toggleYear(year)}
                    className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                      isLatest
                        ? 'text-gray-500 cursor-default'
                        : 'text-gray-500 hover:text-gray-700 cursor-pointer'
                    }`}
                  >
                    {!isLatest && (
                      <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    )}
                    {year}
                    {!expanded && (
                      <span className="font-normal normal-case tracking-normal text-gray-400 ml-1">
                        ({getYearSummary(year)})
                      </span>
                    )}
                  </button>
                )}
                {expanded && (
                  <div className="flex flex-wrap gap-2">
                    {monthsByYear[year].map(monthData => {
                      const monthKey = monthData.month;
                      const monthNum = parseInt(monthKey.slice(5, 7), 10);
                      const name = MONTH_NAMES_SV[monthNum - 1];
                      const isSelected = selectedSet.has(monthKey);
                      const count = monthData.post_count;
                      // gaOnly: no posts, only GA data — show "lyssningar" subtitle instead of 0
                      const gaOnly = count === 0 && monthData.has_ga_listens && !monthData.has_facebook && !monthData.has_instagram;
                      const reachOnly = count === 0 && monthData.has_reach && !gaOnly;

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
                            {gaOnly ? 'lyssningar' : reachOnly ? 'räckvidd' : count.toLocaleString('sv-SE')}
                          </span>
                        </button>
                      );
                    })}
                    {monthsByYear[year].length >= 4 && (() => {
                      const yearMonthKeys = monthsByYear[year].map(m => m.month);
                      const allYearSelected = yearMonthKeys.every(k => selectedSet.has(k));
                      return (
                        <button
                          onClick={() => {
                            if (allYearSelected) {
                              const remaining = sortedSelected.filter(k => !yearMonthKeys.includes(k));
                              if (remaining.length === 0) return;
                              onMonthsChange(remaining);
                            } else {
                              onMonthsChange(yearMonthKeys);
                            }
                          }}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                            allYearSelected
                              ? 'bg-gray-700 text-white border-transparent'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-primary/60 hover:bg-gray-50'
                          }`}
                        >
                          Alla
                        </button>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Custom date range */}
      {mode === 'custom' && allowCustom && (
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
