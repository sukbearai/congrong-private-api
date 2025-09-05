// Centralized alert & retention configuration
// Provide typed, overridable constants (could later read from runtimeConfig or storage)

export interface AlertThresholdConfig {
  longShortRatioChangePercent: number
  openInterestChangePercent: number
  fundingRateWindowChange: number // expressed as absolute rate (e.g. 0.003 => 0.3%)
  fluctuationDuplicateTolerancePercent: number
  retentionMs: {
    shortWindow: number
    announcement: number
  }
  duplicateLookbackMs: {
    fundingRate: number
    fluctuation: number
  }
}

export const alertThresholds: AlertThresholdConfig = {
  longShortRatioChangePercent: 20,
  openInterestChangePercent: 5,
  fundingRateWindowChange: 0.003,
  fluctuationDuplicateTolerancePercent: 2,
  retentionMs: {
    shortWindow: 2 * 60 * 60 * 1000, // 2h
    announcement: 7 * 24 * 60 * 60 * 1000, // 7d
  },
  duplicateLookbackMs: {
    fundingRate: 30 * 60 * 1000, // 30m
    fluctuation: 30 * 60 * 1000,
  },
}

// Helper accessors (leave room for future dynamic overrides)
export function getThreshold<K extends keyof AlertThresholdConfig>(key: K): AlertThresholdConfig[K] {
  return alertThresholds[key]
}

export function getRetention(key: keyof AlertThresholdConfig['retentionMs']) {
  return alertThresholds.retentionMs[key]
}

export function getDuplicateLookback(key: keyof AlertThresholdConfig['duplicateLookbackMs']) {
  return alertThresholds.duplicateLookbackMs[key]
}
