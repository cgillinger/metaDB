import React from 'react';

const PlatformBadge = ({ platform }) => {
  if (!platform || platform === 'mixed') return null;
  if (platform === 'ga_listens') {
    return (
      <span className="inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700">
        GA
      </span>
    );
  }
  const isFB = platform === 'facebook';
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-xs font-medium rounded ${
        isFB
          ? 'bg-blue-100 text-blue-700'
          : 'bg-pink-100 text-pink-700'
      }`}
    >
      {isFB ? 'FB' : 'IG'}
    </span>
  );
};

export default PlatformBadge;
