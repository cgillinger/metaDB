import React from 'react';

const CHANNEL_COLORS = {
  'P1': '#0066cc', 'P2': '#ff6600', 'P3': '#00cc66', 'P4': '#cc33cc',
  'EKOT': '#005eb8', 'RADIOSPORTEN': '#1c5c35', 'SR': '#000000', 'default': '#000000'
};

/**
 * Channel-colored profile icon with initials.
 * @param {string} accountName
 * @param {'sm'|'md'} size - 'sm' = 24px (AccountView), 'md' = 36px (PostView)
 */
const ProfileIcon = ({ accountName, size = 'sm' }) => {
  const name = accountName || 'Okänd';
  const firstLetter = name.charAt(0).toUpperCase();
  let backgroundColor = CHANNEL_COLORS.default;
  let channel = '';
  const nameLower = name.toLowerCase();
  if (nameLower.includes('ekot') || nameLower.includes('radio sweden')) { backgroundColor = CHANNEL_COLORS.EKOT; channel = 'E'; }
  else if (nameLower.includes('radiosporten') || nameLower.includes('radio sporten')) { backgroundColor = CHANNEL_COLORS.RADIOSPORTEN; channel = 'RS'; }
  else if (nameLower.includes('p1')) { backgroundColor = CHANNEL_COLORS.P1; channel = 'P1'; }
  else if (nameLower.includes('p2')) { backgroundColor = CHANNEL_COLORS.P2; channel = 'P2'; }
  else if (nameLower.includes('p3')) { backgroundColor = CHANNEL_COLORS.P3; channel = 'P3'; }
  else if (nameLower.includes('p4')) { backgroundColor = CHANNEL_COLORS.P4; channel = 'P4'; }
  else if (nameLower.includes('sveriges radio')) { backgroundColor = CHANNEL_COLORS.SR; channel = 'SR'; }
  const displayLetter = channel || firstLetter;
  const sizeClasses = size === 'md'
    ? 'w-9 h-9 text-xs'   // 36px
    : 'w-6 h-6 text-xs';  // 24px
  return (
    <div
      className={`flex-shrink-0 rounded-sm flex items-center justify-center font-bold text-white ${sizeClasses}`}
      style={{ backgroundColor }}
    >
      {displayLetter}
    </div>
  );
};

export { CHANNEL_COLORS };
export default ProfileIcon;
