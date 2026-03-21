import React from 'react';
import { Calendar, SlidersHorizontal } from 'lucide-react';
import { Button } from '../ui/button';

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

function formatMonthLabel(monthStr) {
  // "2026-02" → "Feb 26"
  const [year, month] = monthStr.split('-');
  const monthName = MONTH_NAMES_SV[parseInt(month, 10) - 1] || month;
  return `${monthName} ${year.slice(2)}`;
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

  const handleToggleMonth = (month) => {
    if (selectedMonths.includes(month)) {
      // Don't allow deselecting the last month
      if (selectedMonths.length === 1) return;
      onMonthsChange(selectedMonths.filter(m => m !== month));
    } else {
      onMonthsChange([...selectedMonths, month].sort());
    }
  };

  const handleSelectAll = () => {
    onMonthsChange(availableMonths.map(m => m.month));
  };

  const handleSelectLatest = () => {
    if (availableMonths.length === 0) return;
    const sorted = [...availableMonths].sort((a, b) => b.month.localeCompare(a.month));
    onMonthsChange([sorted[0].month]);
  };

  const allSelected = availableMonths.length > 0 &&
    selectedMonths.length === availableMonths.length;

  if (!availableMonths || availableMonths.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-border rounded-lg p-4 space-y-3">
      {/* Header row: icon, mode toggle, action buttons */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Calendar className="h-4 w-4" />
            Period
          </div>

          {/* Mode toggle */}
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

        {/* Action buttons (months mode only) */}
        {mode === 'months' && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={allSelected ? handleSelectLatest : handleSelectAll}
              className="text-xs"
            >
              {allSelected ? 'Senaste' : 'Alla'}
            </Button>
          </div>
        )}
      </div>

      {/* Month pills */}
      {mode === 'months' && (
        <div className="flex flex-wrap gap-2">
          {availableMonths.map(({ month, post_count, has_facebook, has_instagram }) => {
            const isSelected = selectedMonths.includes(month);
            // Color coding: purple = both, blue = FB, pink = IG
            let activeClass = 'bg-primary text-primary-foreground';
            if (isSelected && has_facebook && has_instagram) {
              activeClass = 'bg-purple-600 text-white';
            } else if (isSelected && has_instagram && !has_facebook) {
              activeClass = 'bg-pink-600 text-white';
            } else if (isSelected && has_facebook && !has_instagram) {
              activeClass = 'bg-blue-600 text-white';
            }

            return (
              <button
                key={month}
                onClick={() => handleToggleMonth(month)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                  isSelected
                    ? `${activeClass} border-transparent`
                    : 'bg-white text-gray-600 border-gray-300 hover:border-primary/60 hover:bg-gray-50'
                }`}
              >
                <span className="block">{formatMonthLabel(month)}</span>
                <span className={`block text-xs ${isSelected ? 'opacity-80' : 'text-gray-400'}`}>
                  {post_count.toLocaleString('sv-SE')}
                </span>
              </button>
            );
          })}
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
              onChange={(e) => onCustomRangeChange({
                from: e.target.value,
                to: customRange?.to || ''
              })}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Till:</label>
            <input
              type="date"
              value={customRange?.to || ''}
              onChange={(e) => onCustomRangeChange({
                from: customRange?.from || '',
                to: e.target.value
              })}
              className="border border-input rounded-md px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PeriodSelector;
