import React, { useState, useEffect } from 'react';
import { AlertCircle, HardDrive } from 'lucide-react';
import { getMemoryUsageStats } from '@/utils/storageService';
import { MEMORY_THRESHOLDS } from '@/utils/memoryUtils';

export function StorageIndicator({ showDetails = false, compact = false, onUpdate = null }) {
  const [memoryUsage, setMemoryUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const isMounted = React.useRef(true);

  useEffect(() => {
    isMounted.current = true;

    const fetchMemoryUsage = async () => {
      if (!isMounted.current) return;
      setLoading(true);
      try {
        const stats = await getMemoryUsageStats();
        if (isMounted.current) {
          setMemoryUsage(stats);
          if (onUpdate && typeof onUpdate === 'function') {
            onUpdate(stats);
          }
        }
      } catch (error) {
        console.error('Fel vid hämtning av minnesanvändning:', error);
      } finally {
        if (isMounted.current) {
          setLoading(false);
        }
      }
    };

    fetchMemoryUsage();
    const intervalId = setInterval(fetchMemoryUsage, 30000);

    return () => {
      isMounted.current = false;
      clearInterval(intervalId);
    };
  }, []);

  if (loading || !memoryUsage) {
    return (
      <div className="flex items-center text-sm text-muted-foreground">
        <HardDrive className="w-4 h-4 mr-2" />
        <span>Beräknar lagringsanvändning...</span>
      </div>
    );
  }

  let statusColor = 'bg-green-500';
  let statusText = 'Säker';
  let textColor = 'text-green-700';

  if (parseFloat(memoryUsage.percentUsed) >= MEMORY_THRESHOLDS.CRITICAL) {
    statusColor = 'bg-red-500';
    statusText = 'Kritisk';
    textColor = 'text-red-700';
  } else if (parseFloat(memoryUsage.percentUsed) >= MEMORY_THRESHOLDS.WARNING) {
    statusColor = 'bg-yellow-500';
    statusText = 'Varning';
    textColor = 'text-yellow-700';
  }

  if (compact) {
    return (
      <div className="flex items-center" title={`Lagringsanvändning: ${memoryUsage.percentUsed}%`}>
        <div className="h-2 w-24 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full ${statusColor}`}
            style={{ width: `${Math.min(100, memoryUsage.percentUsed)}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-md border p-3 ${memoryUsage.isNearLimit ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center">
          <HardDrive className={`w-4 h-4 mr-2 ${textColor}`} />
          <span className="font-medium">Lagringsanvändning</span>
        </div>
        <span className={`text-sm font-bold ${textColor}`}>{statusText}</span>
      </div>

      <div className="space-y-2">
        <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full ${statusColor}`}
            style={{ width: `${Math.min(100, memoryUsage.percentUsed)}%` }}
          />
        </div>

        <div className="flex justify-between text-sm">
          <span>{memoryUsage.percentUsed}% använt</span>
          <span>{memoryUsage.totalSizeMB} MB</span>
        </div>

        {memoryUsage.isNearLimit && (
          <div className="flex items-center mt-2 text-sm text-yellow-700">
            <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" />
            <span>Lagringsanvändningen närmar sig gränsen. Överväg att rensa data.</span>
          </div>
        )}

        {!memoryUsage.canAddMoreData && (
          <div className="flex items-center mt-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" />
            <span>Kritisk lagringsnivå nådd. Du behöver rensa data innan du kan lägga till mer.</span>
          </div>
        )}

        {showDetails && (
          <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500">
            <div className="grid grid-cols-2 gap-1">
              <span>Inlägg-data:</span>
              <span className="text-right">{(memoryUsage.postViewSize / (1024 * 1024)).toFixed(2)} MB</span>
              <span>Konto-data:</span>
              <span className="text-right">{(memoryUsage.accountViewSize / (1024 * 1024)).toFixed(2)} MB</span>
              <span>Metadata:</span>
              <span className="text-right">{(memoryUsage.metadataSize / (1024 * 1024)).toFixed(2)} MB</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default StorageIndicator;
