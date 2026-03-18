/**
 * Memory Utilities for Meta Analytics
 */

export const MEMORY_THRESHOLDS = {
  WARNING: 70,
  CRITICAL: 90
};

const STORAGE_LIMITS = {
  UNIFIED: 2 * 1024 * 1024 * 1024 + 5 * 1024 * 1024
};

export function calculateObjectSize(object) {
  if (object === null || object === undefined) return 0;
  if (typeof object === 'string') return object.length * 2;
  if (typeof object !== 'object') return 8;
  try {
    return JSON.stringify(object).length * 2;
  } catch (e) {
    return 0;
  }
}

export function calculateMemoryUsage(fileMetadataList, postViewData, accountViewData) {
  const postViewSize = calculateObjectSize(postViewData);
  const accountViewSize = calculateObjectSize(accountViewData);
  const metadataSize = calculateObjectSize(fileMetadataList);
  const totalDataSize = postViewSize + accountViewSize + metadataSize;
  const totalPercent = Math.min(100, (totalDataSize / STORAGE_LIMITS.UNIFIED) * 100);

  let status = 'safe';
  if (totalPercent >= MEMORY_THRESHOLDS.CRITICAL) status = 'critical';
  else if (totalPercent >= MEMORY_THRESHOLDS.WARNING) status = 'warning';

  const remainingBytes = STORAGE_LIMITS.UNIFIED - totalDataSize;
  const filesInfo = estimateAdditionalFileCapacity(fileMetadataList, remainingBytes);

  return {
    totalSize: totalDataSize,
    totalSizeMB: (totalDataSize / (1024 * 1024)).toFixed(2),
    remainingMB: (remainingBytes / (1024 * 1024)).toFixed(2),
    postViewSize,
    accountViewSize,
    metadataSize,
    percentUsed: totalPercent.toFixed(1),
    status,
    canAddMoreData: totalPercent < MEMORY_THRESHOLDS.CRITICAL,
    isNearLimit: totalPercent >= MEMORY_THRESHOLDS.WARNING,
    estimatedAdditionalFiles: filesInfo.estimatedAdditionalFiles,
    averageFileSizeKB: filesInfo.averageFileSizeKB
  };
}

function estimateAdditionalFileCapacity(fileMetadataList, remainingBytes) {
  if (!fileMetadataList || fileMetadataList.length === 0) {
    const defaultFileSizeKB = 500;
    return {
      estimatedAdditionalFiles: Math.max(0, Math.floor(remainingBytes / (defaultFileSizeKB * 1024))),
      averageFileSizeKB: defaultFileSizeKB
    };
  }

  let totalRows = 0;
  for (const file of fileMetadataList) {
    totalRows += (file.rowCount || 0);
  }

  const bytesPerRow = 1500;
  const totalEstimatedBytes = totalRows * bytesPerRow;
  const averageFileSize = totalEstimatedBytes / fileMetadataList.length || 500 * 1024;

  return {
    estimatedAdditionalFiles: Math.max(0, Math.floor(remainingBytes / averageFileSize)),
    averageFileSizeKB: Math.round(averageFileSize / 1024)
  };
}

export function calculateMemoryWithNewFile(newFileStats, currentMemoryUsage) {
  const estimatedNewSize = (newFileStats.rows || 0) * (newFileStats.columns || 0) * 15 * 1.2;
  const currentSize = parseFloat(currentMemoryUsage.totalSize) || 0;
  const projectedSize = currentSize + estimatedNewSize;
  const projectedPercent = (projectedSize / STORAGE_LIMITS.UNIFIED) * 100;

  let status = 'safe';
  if (projectedPercent >= MEMORY_THRESHOLDS.CRITICAL) status = 'critical';
  else if (projectedPercent >= MEMORY_THRESHOLDS.WARNING) status = 'warning';

  const remainingAfterNewFile = STORAGE_LIMITS.UNIFIED - projectedSize;
  const filesInfo = estimateAdditionalFileCapacity(
    currentMemoryUsage.filesMetadata || [],
    remainingAfterNewFile
  );

  return {
    currentSize,
    estimatedNewSize,
    projectedSize,
    projectedSizeMB: (projectedSize / (1024 * 1024)).toFixed(2),
    projectedPercent: projectedPercent.toFixed(1),
    status,
    canAddFile: projectedPercent < MEMORY_THRESHOLDS.CRITICAL,
    estimatedRemainingFiles: filesInfo.estimatedAdditionalFiles
  };
}
