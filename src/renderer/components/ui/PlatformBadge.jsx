/**
 * PlatformBadge — small inline badge showing the data source.
 * Renders 'FB' (blue), 'IG' (pink), or 'GA' (green) depending on platform.
 * The `google_analytics` key renders a unified GA badge without subLabel.
 * The `ga_listens` / `ga_site_visits` keys include a small subLabel for
 * contexts where the specific source matters (e.g. HiddenAccountsManager).
 */
import React from 'react';

const PLATFORM_CONFIG = {
  facebook:         { label: 'FB', className: 'bg-blue-100 text-blue-700' },
  instagram:        { label: 'IG', className: 'bg-pink-100 text-pink-700' },
  google_analytics: { label: 'GA', className: 'bg-green-100 text-green-800' },
  ga_listens:       { label: 'GA', subLabel: 'lyssningar', className: 'bg-green-100 text-green-800' },
  ga_site_visits:   { label: 'GA', subLabel: 'besök',      className: 'bg-green-100 text-green-800' },
};

const PlatformBadge = ({ platform }) => {
  if (!platform || platform === 'mixed') return null;
  const cfg = PLATFORM_CONFIG[platform] || { label: platform, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded ${cfg.className}`}>
        {cfg.label}
      </span>
      {cfg.subLabel && (
        <span className="text-[10px] text-muted-foreground">{cfg.subLabel}</span>
      )}
    </span>
  );
};

export default PlatformBadge;
