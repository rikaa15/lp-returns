import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

// Types
interface AnalysisRow {
  timestamp: string;
  timestamp_excel: string;
  tx_hash: string;
  block: number;
  block_index: number;
  swap_block: number;
  swap_index: number;
  swap_hash: string;
  token_id: string;
  action: string;
  cbBTC_price: number;
  tick_lower: string;
  tick_upper: string;
  amount0_dec: number;
  amount1_dec: number;
  fee0_dec: number;
  fee1_dec: number;
  reward: number;
  amount0_usd: number;
  amount1_usd: number;
  AERO_usd: number;
}

interface PositionStats {
  token_id: string;
  events_count: number;
  
  // Mint data
  mint_count: number;
  first_mint_timestamp: Date | null;
  total_deposit_usdc: number;
  total_deposit_cbbtc: number;
  btc_price_at_first_mint: number;
  
  // Burn data
  burn_count: number;
  first_burn_timestamp: Date | null;
  total_withdraw_usdc: number;
  total_withdraw_cbbtc: number;
  btc_price_at_first_burn: number;
  
  // Rewards and fees
  total_aero_rewards: number;
  total_fees_usd: number;
  
  // Calculated metrics
  active_time_seconds: number;
  impermanent_loss_usd: number;
  profit_usd: number;
}

interface WalletStats {
  positions_count: number;
  events_count: number;
  total_deposit_usdc: number;
  total_deposit_cbbtc: number;
  total_withdraw_usdc: number;
  total_withdraw_cbbtc: number;
  avg_active_time_seconds: number;
  total_fees_usd: number;
  total_collected_aero_rewards: number; // AERO tokens
  total_collected_aero_rewards_usd: number; // USD value
  total_impermanent_loss_usd: number;
  total_profit_usd: number;
}

interface DailyStats {
  date: string; // YYYY-MM-DD
  events_count: number;
  positions_opened: number; // mints
  positions_closed: number; // burns
  deposit_usdc: number;
  deposit_cbbtc: number;
  deposit_value_usd: number;
  withdraw_usdc: number;
  withdraw_cbbtc: number;
  withdraw_value_usd: number;
  fees_collected_usd: number;
  aero_rewards_collected: number;
  daily_profit_usd: number; // fees + rewards for that day
}

function calculatePositionStats(rows: AnalysisRow[]): PositionStats {
  const token_id = rows[0].token_id || "unknown";
  
  // Separate events by type
  const mints = rows.filter(r => r.action === "mint");
  const burns = rows.filter(r => r.action === "burn");
  const collects = rows.filter(r => r.action === "collect");
  const getRewards = rows.filter(r => r.action === "gauge_getReward");
  
  // Sort by timestamp
  mints.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  burns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  // Calculate mint totals (use already-calculated USD values which have correct per-mint prices)
  const total_deposit_usdc = mints.reduce((sum, m) => sum + m.amount0_dec, 0);
  const total_deposit_cbbtc = mints.reduce((sum, m) => sum + m.amount1_dec, 0);
  const total_deposit_usd = mints.reduce((sum, m) => sum + m.amount0_usd + m.amount1_usd, 0);
  const first_mint = mints[0];
  const btc_price_at_first_mint = first_mint ? first_mint.cbBTC_price : 0;
  
  // Calculate burn totals (use already-calculated USD values which have correct per-burn prices)
  const total_withdraw_usdc = burns.reduce((sum, b) => sum + b.amount0_dec, 0);
  const total_withdraw_cbbtc = burns.reduce((sum, b) => sum + b.amount1_dec, 0);
  const total_withdraw_usd = burns.reduce((sum, b) => sum + b.amount0_usd + b.amount1_usd, 0);
  const first_burn = burns[0];
  const btc_price_at_first_burn = first_burn ? first_burn.cbBTC_price : 0;
  
  // Calculate fees from collect events
  const total_fees_usdc = collects.reduce((sum, c) => sum + c.fee0_dec, 0);
  const total_fees_cbbtc = collects.reduce((sum, c) => sum + c.fee1_dec, 0);
  const total_fees_usd = collects.reduce((sum, c) => {
    const fee_usd = c.fee0_dec + (c.fee1_dec * c.cbBTC_price);
    return sum + fee_usd;
  }, 0);
  
  // Calculate total rewards (exclude gauge_getReward - those are wallet-level only)
  const total_aero_rewards = rows
    .filter(r => r.action !== "gauge_getReward")
    .reduce((sum, r) => sum + r.reward, 0);
  
  // Calculate total rewards in USD (using real AERO prices from CSV)
  const total_aero_rewards_usd = rows
    .filter(r => r.action !== "gauge_getReward")
    .reduce((sum, r) => sum + r.AERO_usd, 0);
  
  // Calculate active time
  let active_time_seconds = 0;
  if (first_mint && first_burn) {
    const mintTime = new Date(first_mint.timestamp);
    const burnTime = new Date(first_burn.timestamp);
    active_time_seconds = (burnTime.getTime() - mintTime.getTime()) / 1000;
  }
  
  // Calculate profit and impermanent loss using the same formulas from deprecated/index.ts
  let profit_usd = 0;
  let impermanent_loss_usd = 0;
  
  if (first_mint && first_burn) {
    // Use already-calculated USD values (which have correct prices for each transaction)
    const hodlValueAtDepositUSD = total_deposit_usd; // Deposit valued at time of deposit
    const lpValueAtExitUSD = total_withdraw_usd;      // Withdraw valued at time of withdrawal
    
    // Calculate HODL value at exit (for IL calculation)
    // We need to value the deposited tokens at the withdrawal prices
    // For multiple burns at different prices, use weighted average
    let totalWithdrawValue = 0;
    let totalCbbtcWithdrawn = 0;
    
    for (const burn of burns) {
      totalWithdrawValue += burn.amount0_usd + burn.amount1_usd;
      totalCbbtcWithdrawn += burn.amount1_dec;
    }
    
    // Calculate weighted average exit price
    const avgExitPrice = totalCbbtcWithdrawn > 0 
      ? (totalWithdrawValue - burns.reduce((sum, b) => sum + b.amount0_dec, 0)) / totalCbbtcWithdrawn
      : btc_price_at_first_burn;
    
    // HODL value at exit = what you deposited, valued at average exit price
    const hodlValueAtExitUSD = total_deposit_usdc + (total_deposit_cbbtc * avgExitPrice);
    
    
    // Impermanent loss = LP value (without fees) - HODL value (both at exit time)
    // Now works for positions with any number of mints/burns
    if (burns.length > 0) {
      impermanent_loss_usd = lpValueAtExitUSD - hodlValueAtExitUSD;
      
    }
    
    // Profit = (LP value at exit - HODL value at deposit) + rewards (matching deprecated code)
    // This includes: IL + HODL_gain + fees + rewards
    // Now using real AERO prices from CoinGecko
    const collectedRewardsAmountUSD = total_aero_rewards_usd;
    profit_usd = (lpValueAtExitUSD - hodlValueAtDepositUSD) + collectedRewardsAmountUSD;
  }
  
  return {
    token_id,
    events_count: rows.length,
    mint_count: mints.length,
    first_mint_timestamp: first_mint ? new Date(first_mint.timestamp) : null,
    total_deposit_usdc,
    total_deposit_cbbtc,
    btc_price_at_first_mint,
    burn_count: burns.length,
    first_burn_timestamp: first_burn ? new Date(first_burn.timestamp) : null,
    total_withdraw_usdc,
    total_withdraw_cbbtc,
    btc_price_at_first_burn,
    total_fees_usd,
    total_aero_rewards,
    active_time_seconds,
    impermanent_loss_usd,
    profit_usd,
  };
}

function calculateDailyStats(rows: AnalysisRow[]): DailyStats[] {
  // Group events by date (YYYY-MM-DD)
  const dailyMap = new Map<string, AnalysisRow[]>();
  
  rows.forEach(row => {
    const date = row.timestamp.split('T')[0]; // Extract YYYY-MM-DD
    if (!dailyMap.has(date)) {
      dailyMap.set(date, []);
    }
    dailyMap.get(date)!.push(row);
  });
  
  // Calculate stats for each day
  const dailyStats: DailyStats[] = [];
  
  for (const [date, dayRows] of dailyMap) {
    const mints = dayRows.filter(r => r.action === "mint");
    const burns = dayRows.filter(r => r.action === "burn");
    const collects = dayRows.filter(r => r.action === "collect");
    
    const deposit_usdc = mints.reduce((sum, m) => sum + m.amount0_dec, 0);
    const deposit_cbbtc = mints.reduce((sum, m) => sum + m.amount1_dec, 0);
    const deposit_value_usd = mints.reduce((sum, m) => sum + m.amount0_usd + m.amount1_usd, 0);
    
    const withdraw_usdc = burns.reduce((sum, b) => sum + b.amount0_dec, 0);
    const withdraw_cbbtc = burns.reduce((sum, b) => sum + b.amount1_dec, 0);
    const withdraw_value_usd = burns.reduce((sum, b) => sum + b.amount0_usd + b.amount1_usd, 0);
    
    const fees_collected_usd = collects.reduce((sum, c) => {
      return sum + c.fee0_dec + (c.fee1_dec * c.cbBTC_price);
    }, 0);
    
    const aero_rewards_collected = dayRows.reduce((sum, r) => sum + r.AERO_usd, 0);
    
    // Daily profit = fees + rewards (simple calculation for daily view)
    // Now using real AERO prices from CoinGecko
    const daily_profit_usd = fees_collected_usd + aero_rewards_collected;
    
    dailyStats.push({
      date,
      events_count: dayRows.length,
      positions_opened: mints.length,
      positions_closed: burns.length,
      deposit_usdc,
      deposit_cbbtc,
      deposit_value_usd,
      withdraw_usdc,
      withdraw_cbbtc,
      withdraw_value_usd,
      fees_collected_usd,
      aero_rewards_collected,
      daily_profit_usd,
    });
  }
  
  // Sort by date
  dailyStats.sort((a, b) => a.date.localeCompare(b.date));
  
  return dailyStats;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${minutes}m`;
  }
  
  return `${hours}h ${minutes}m ${secs}s`;
}

async function main() {
  console.log("LP Returns Analysis - Calculating Summary Statistics");
  console.log("=".repeat(60));
  
  // Read the analysis CSV
  const csvPath = path.join(__dirname, "..", "output", "lp_analysis.csv");
  
  if (!fs.existsSync(csvPath)) {
    console.error(`Error: ${csvPath} not found. Please run the main script first.`);
    process.exit(1);
  }
  
  console.log("\nReading analysis CSV...");
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  
  const rows: AnalysisRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    cast: (value, context) => {
      const numericColumns = [
        "block", "block_index", "swap_block", "swap_index",
        "cbBTC_price", "amount0_dec", "amount1_dec", "fee0_dec", "fee1_dec",
        "reward", "amount0_usd", "amount1_usd", "AERO_usd"
      ];
      
      if (numericColumns.includes(String(context.column))) {
        return parseFloat(value) || 0;
      }
      return value;
    }
  });
  
  console.log(`Loaded ${rows.length} events`);
  
  // Group by token_id (position), excluding empty token_ids
  const positionMap = new Map<string, AnalysisRow[]>();
  
  rows.forEach(row => {
    // Skip events without token_id - don't create an "unknown" position
    if (!row.token_id || row.token_id === "") {
      return;
    }
    
    if (!positionMap.has(row.token_id)) {
      positionMap.set(row.token_id, []);
    }
    positionMap.get(row.token_id)!.push(row);
  });
  
  // Track events without token_id separately (for AERO rewards accounting)
  const noTokenEvents = rows.filter(r => !r.token_id || r.token_id === "");
  
  console.log(`Found ${positionMap.size} unique positions`);
  if (noTokenEvents.length > 0) {
    console.log(`Found ${noTokenEvents.length} events without token_id (rewards will be added to wallet total, but not counted as separate position)`);
  }
  console.log();
  
  // Calculate stats for each position
  const positionStats: PositionStats[] = [];
  
  for (const [tokenId, positionRows] of positionMap) {
    const stats = calculatePositionStats(positionRows);
    positionStats.push(stats);
    
    console.log(`Position ${tokenId}:`);
    console.log(`  Events: ${stats.events_count}`);
    console.log(`  Mints: ${stats.mint_count}, Burns: ${stats.burn_count}`);
    console.log(`  Deposited: $${stats.total_deposit_usdc.toFixed(2)} USDC, ${stats.total_deposit_cbbtc.toFixed(8)} cbBTC`);
    console.log(`  Withdrew: $${stats.total_withdraw_usdc.toFixed(2)} USDC, ${stats.total_withdraw_cbbtc.toFixed(8)} cbBTC`);
    console.log(`  AERO Rewards: ${stats.total_aero_rewards.toFixed(4)} ($${stats.total_aero_rewards.toFixed(2)})`);
    console.log(`  Active Time: ${formatDuration(stats.active_time_seconds)}`);
    console.log(`  Profit: $${stats.profit_usd.toFixed(2)}`);
    if (stats.impermanent_loss_usd !== 0) {
      console.log(`  Impermanent Loss: $${stats.impermanent_loss_usd.toFixed(2)}`);
    }
    console.log();
  }
  
  // Calculate daily stats
  console.log("\n" + "=".repeat(60));
  console.log("CALCULATING DAILY STATISTICS");
  console.log("=".repeat(60) + "\n");
  
  const dailyStats = calculateDailyStats(rows);
  console.log(`Calculated stats for ${dailyStats.length} days\n`);
  
  // Calculate wallet-level aggregated stats
  // For AERO USD, sum from all events (position-specific + gauge_getReward)
  const allAeroRewardsUsd = rows.reduce((sum, r) => sum + r.AERO_usd, 0);
  
  const walletStats: WalletStats = {
    positions_count: positionMap.size,
    events_count: rows.length,
    total_deposit_usdc: positionStats.reduce((sum, p) => sum + p.total_deposit_usdc, 0),
    total_deposit_cbbtc: positionStats.reduce((sum, p) => sum + p.total_deposit_cbbtc, 0),
    total_withdraw_usdc: positionStats.reduce((sum, p) => sum + p.total_withdraw_usdc, 0),
    total_withdraw_cbbtc: positionStats.reduce((sum, p) => sum + p.total_withdraw_cbbtc, 0),
    avg_active_time_seconds: positionStats.length > 0
      ? positionStats.reduce((sum, p) => sum + p.active_time_seconds, 0) / positionStats.length
      : 0,
    total_fees_usd: positionStats.reduce((sum, p) => sum + p.total_fees_usd, 0),
    total_collected_aero_rewards: positionStats.reduce((sum, p) => sum + p.total_aero_rewards, 0),
    total_collected_aero_rewards_usd: allAeroRewardsUsd,
    total_impermanent_loss_usd: positionStats.reduce((sum, p) => sum + p.impermanent_loss_usd, 0),
    total_profit_usd: positionStats.reduce((sum, p) => sum + p.profit_usd, 0),
  };
  
  // Add gauge_getReward rewards to token count (wallet-level, not position-specific)
  const gaugeRewards = rows
    .filter(r => r.action === "gauge_getReward")
    .reduce((sum, e) => sum + e.reward, 0);
  walletStats.total_collected_aero_rewards += gaugeRewards;
  
  // Calculate net position changes
  const usdcChange = walletStats.total_withdraw_usdc - walletStats.total_deposit_usdc;
  const cbbtcChange = walletStats.total_withdraw_cbbtc - walletStats.total_deposit_cbbtc;
  
  // Create output directory
  const outputDir = path.join(__dirname, "..", "output");
  
  // Generate combined summary CSV with positions + wallet summary at the end
  const combinedCsvData = [
    // Position rows
    ...positionStats.map(pos => ({
      row_type: "position",
      token_id: pos.token_id,
      positions_count: "",
      events_count: pos.events_count,
      mint_count: pos.mint_count,
      burn_count: pos.burn_count,
      active_time_seconds: pos.active_time_seconds,
      first_mint_timestamp: pos.first_mint_timestamp?.toISOString() || "",
      first_burn_timestamp: pos.first_burn_timestamp?.toISOString() || "",
      total_deposit_usdc: pos.total_deposit_usdc,
      total_deposit_cbbtc: pos.total_deposit_cbbtc,
      btc_price_at_deposit: pos.btc_price_at_first_mint,
      deposit_value_usd: pos.total_deposit_usdc + (pos.total_deposit_cbbtc * pos.btc_price_at_first_mint),
      total_withdraw_usdc: pos.total_withdraw_usdc,
      total_withdraw_cbbtc: pos.total_withdraw_cbbtc,
      btc_price_at_withdrawal: pos.btc_price_at_first_burn,
      withdrawal_value_usd: pos.total_withdraw_usdc + (pos.total_withdraw_cbbtc * pos.btc_price_at_first_burn),
      net_usdc_change: "",
      net_cbbtc_change: "",
      total_fees_usd: pos.total_fees_usd,
      impermanent_loss_usd: pos.impermanent_loss_usd,
      profit_usd: pos.profit_usd,
    })),
    // Wallet summary row at the end (AERO excluded - see analysis_by_day.csv for wallet-level AERO)
    {
      row_type: "wallet_summary",
      token_id: "WALLET_TOTAL",
      positions_count: walletStats.positions_count,
      events_count: walletStats.events_count,
      mint_count: "",
      burn_count: "",
      active_time_seconds: walletStats.avg_active_time_seconds,
      first_mint_timestamp: "",
      first_burn_timestamp: "",
      total_deposit_usdc: walletStats.total_deposit_usdc,
      total_deposit_cbbtc: walletStats.total_deposit_cbbtc,
      btc_price_at_deposit: "",
      deposit_value_usd: "",
      total_withdraw_usdc: walletStats.total_withdraw_usdc,
      total_withdraw_cbbtc: walletStats.total_withdraw_cbbtc,
      btc_price_at_withdrawal: "",
      withdrawal_value_usd: "",
      net_usdc_change: usdcChange,
      net_cbbtc_change: cbbtcChange,
      total_fees_usd: walletStats.total_fees_usd,
      impermanent_loss_usd: walletStats.total_impermanent_loss_usd,
      profit_usd: walletStats.total_profit_usd,
    }
  ];
  
  const combinedCsv = stringify(combinedCsvData, {
    header: true,
  });
  
  const summaryPath = path.join(outputDir, "analysis_summary.csv");
  fs.writeFileSync(summaryPath, combinedCsv, "utf-8");
  
  // Add summary row to daily stats
  const dailySummary = {
    date: "TOTAL",
    events_count: dailyStats.reduce((sum, d) => sum + d.events_count, 0),
    positions_opened: dailyStats.reduce((sum, d) => sum + d.positions_opened, 0),
    positions_closed: dailyStats.reduce((sum, d) => sum + d.positions_closed, 0),
    deposit_usdc: dailyStats.reduce((sum, d) => sum + d.deposit_usdc, 0),
    deposit_cbbtc: dailyStats.reduce((sum, d) => sum + d.deposit_cbbtc, 0),
    deposit_value_usd: dailyStats.reduce((sum, d) => sum + d.deposit_value_usd, 0),
    withdraw_usdc: dailyStats.reduce((sum, d) => sum + d.withdraw_usdc, 0),
    withdraw_cbbtc: dailyStats.reduce((sum, d) => sum + d.withdraw_cbbtc, 0),
    withdraw_value_usd: dailyStats.reduce((sum, d) => sum + d.withdraw_value_usd, 0),
    fees_collected_usd: dailyStats.reduce((sum, d) => sum + d.fees_collected_usd, 0),
    aero_rewards_collected: dailyStats.reduce((sum, d) => sum + d.aero_rewards_collected, 0),
    daily_profit_usd: dailyStats.reduce((sum, d) => sum + d.daily_profit_usd, 0),
  };
  
  // Export daily stats CSV with summary row at the end
  const dailyCsvData = [...dailyStats, dailySummary];
  const dailyCsv = stringify(dailyCsvData, {
    header: true,
  });
  
  const dailyPath = path.join(outputDir, "analysis_by_day.csv");
  fs.writeFileSync(dailyPath, dailyCsv, "utf-8");
  
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Positions:           ${walletStats.positions_count}`);
  console.log(`Total Events:        ${walletStats.events_count}`);
  console.log(`Total Fees:          $${walletStats.total_fees_usd.toFixed(2)}`);
  console.log(`AERO Rewards:        ${walletStats.total_collected_aero_rewards.toFixed(4)} AERO ($${walletStats.total_collected_aero_rewards_usd.toFixed(2)})`);
  console.log(`Impermanent Loss:    $${walletStats.total_impermanent_loss_usd.toFixed(2)}`);
  console.log(`Total Profit:        $${walletStats.total_profit_usd.toFixed(2)}`);
  console.log("=".repeat(60));
  console.log(`\n✓ Analysis summary written to: ${summaryPath}`);
  console.log(`✓ Daily analysis written to: ${dailyPath}`);
  console.log("\nDone!");
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

