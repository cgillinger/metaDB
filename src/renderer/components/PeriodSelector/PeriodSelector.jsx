import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, SlidersHorizontal } from 'lucide-react';

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

const TERTIALS = [
  { label: 'T1', months: [1, 2, 3, 4] },
  { label: 'T2', months: [5, 6, 7, 8] },
  { label: 'T3', months: [9, 10, 11, 12] },
];

function padMonth(n) {
  return String(n).padStart(2, '0');
}

const PeriodSelector = ({
  availableMonths,
  selectedMonths,
  onMonthsChange,
  customRange,
  onCustomRangeChange,
  mode,
  onModeChange,
}) => {
  // Unique sorted years derived from availableMonths
  const years = useMemo(() => {
    return [...new Set(availableMonths.map(m => m.month.slice(0, 4)))].sort();
  }, [availableMonths]);

  // Internal year state — initialized from selectedMonths or latest year
  const [selectedYear, setSelectedYear] = useState(() => {
    if (selectedMonths.length > 0) return selectedMonths[0].slice(0, 4);
    if (availableMonths.length > 0) {
      return [...availableMonths].sort((a, b) => b.month.localeCompare(a.month))[0].month.slice(0, 4);
    }
    return '';
  });

  // Sync selectedYear when selectedMonths changes from outside (e.g. initial default load)
  useEffect(() => {
    if (selectedMonths.length > 0) {
      const incomingYear = selectedMonths[0].slice(0, 4);
      if (incomingYear !== selectedYear) setSelectedYear(incomingYear);
    }
  }, [selectedMonths]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map of monthNum → monthData for the selected year
  const availableForYear = useMemo(() => {
    return new Map(
      availableMonths
        .filter(m => m.month.slice(0, 4) === selectedYear)
        .map(m => [parseInt(m.month.slice(5, 7), 10), m])
    );
  }, [availableMonths, selectedYear]);

  // Selected month numbers (within selected year), sorted
  const selectedNums = useMemo(() => {
    return selectedMonths
      .filter(m => m.slice(0, 4) === selectedYear)
      .map(m => parseInt(m.slice(5, 7), 10))
      .sort((a, b) => a - b);
  }, [selectedMonths, selectedYear]);

  const handleYearClick = (year) => {
    if (year === selectedYear) return;
    setSelectedYear(year);
    // Default to latest available month in the new year
    const inYear = availableMonths
      .filter(m => m.month.slice(0, 4) === year)
      .sort((a, b) => b.month.localeCompare(a.month));
    if (inYear.length > 0) {
      onMonthsChange([inYear[0].month]);
    }
  };

  const handleMonthClick = (monthNum) => {
    if (!availableForYear.has(monthNum)) return;

    const isSelected = selectedNums.includes(monthNum);

    if (isSelected) {
      if (selectedNums.length === 1) return; // must keep at least one
      const min = selectedNums[0];
      const max = selectedNums[selectedNums.length - 1];
      const isAtEnd = monthNum === min || monthNum === max;
      if (isAtEnd) {
        // Shrink from end
        const next = selectedNums.filter(n => n !== monthNum);
        onMonthsChange(next.map(n => `${selectedYear}-${padMonth(n)}`));
      } else {
        // Middle month clicked — reset to just this month
        onMonthsChange([`${selectedYear}-${padMonth(monthNum)}`]);
      }
    } else {
      if (selectedNums.length === 0) {
        onMonthsChange([`${selectedYear}-${padMonth(monthNum)}`]);
        return;
      }
      const min = selectedNums[0];
      const max = selectedNums[selectedNums.length - 1];
      const isAdjacent = monthNum === min - 1 || monthNum === max + 1;
      if (isAdjacent) {
        // Extend selection
        const next = [...selectedNums, monthNum].sort((a, b) => a - b);
        onMonthsChange(next.map(n => `${selectedYear}-${padMonth(n)}`));
      } else {
        // Non-adjacent — start fresh
        onMonthsChange([`${selectedYear}-${padMonth(monthNum)}`]);
      }
    }
  };

  const handleTertialClick = (tMonths) => {
    onMonthsChange(tMonths.map(n => `${selectedYear}-${padMonth(n)}`));
  };

  const getActiveClass = (monthNum) => {
    const d = availableForYear.get(monthNum);
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
          {/* Year selector — only shown when >1 year exists */}
          {years.length > 1 && (
            <div className="flex gap-2">
              {years.map(year => (
                <button
                  key={year}
                  onClick={() => handleYearClick(year)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold border transition-colors ${
                    selectedYear === year
                      ? 'bg-primary text-primary-foreground border-transparent'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-primary/60 hover:bg-gray-50'
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
          )}

          {availableForYear.size === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen data finns för {selectedYear}</p>
          ) : (
            <>
              {/* Tertial shortcuts */}
              <div className="flex gap-2">
                {TERTIALS.map(({ label, months: tMonths }) => {
                  const allAvail = tMonths.every(n => availableForYear.has(n));
                  const isActive = selectedNums.length === tMonths.length &&
                    tMonths.every(n => selectedNums.includes(n));
                  return (
                    <button
                      key={label}
                      onClick={() => allAvail && handleTertialClick(tMonths)}
                      disabled={!allAvail}
                      title={!allAvail ? `Alla månader i ${label} finns inte för ${selectedYear}` : undefined}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        !allAvail
                          ? 'opacity-50 cursor-not-allowed bg-white text-gray-400 border-gray-200'
                          : isActive
                            ? 'bg-primary text-primary-foreground border-transparent'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-primary/60 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* 12 month buttons */}
              <div className="flex flex-wrap gap-2">
                {MONTH_NAMES_SV.map((name, idx) => {
                  const monthNum = idx + 1;
                  const monthData = availableForYear.get(monthNum);
                  const isAvail = !!monthData;
                  const isSelected = selectedNums.includes(monthNum);

                  return (
                    <button
                      key={monthNum}
                      onClick={() => handleMonthClick(monthNum)}
                      disabled={!isAvail}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        !isAvail
                          ? 'opacity-50 cursor-not-allowed bg-white text-gray-300 border-gray-200'
                          : isSelected
                            ? `${getActiveClass(monthNum)} border-transparent`
                            : 'bg-white text-gray-600 border-gray-300 hover:border-primary/60 hover:bg-gray-50'
                      }`}
                    >
                      <span className="block">{name}</span>
                      {isAvail && (
                        <span className={`block text-xs ${isSelected ? 'opacity-80' : 'text-gray-400'}`}>
                          {monthData.post_count.toLocaleString('sv-SE')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
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
