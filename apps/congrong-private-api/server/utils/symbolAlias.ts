// Centralized symbol alias mapping for different exchanges.
// Add more entries as you encounter mismatches between platforms.

export type Exchange = 'binance' | 'bybit'

// Keyed by the symbol you currently store (e.g., from telegram:ol),
// values are per-exchange aliases.
const ALIASES: Record<string, Partial<Record<Exchange, string>>> = {
  // Example: Bybit futures sometimes list as PUMPFUNUSDT while Binance uses PUMPUSDT
  PUMPFUNUSDT: { binance: 'PUMPUSDT' },
}

export function aliasForExchange(symbol: string, exchange: Exchange): string {
  return ALIASES[symbol]?.[exchange] ?? symbol
}
