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
  total_deposit_usd: number; // USD value at deposit time (using each mint's own price)
  btc_price_at_first_mint: number;
  
  // Burn data
  burn_count: number;
  first_burn_timestamp: Date | null;
  total_withdraw_usdc: number;
  total_withdraw_cbbtc: number;
  total_withdraw_usd: number; // USD value at withdrawal time (using each burn's own price)
  btc_price_at_first_burn: number;
  
  // Rewards and fees
  total_aero_rewards: number;
  total_fees_usd: number;
  
  // Calculated metrics
  active_time_seconds: number;
  impermanent_loss_usd: number;
  profit_usd: number;
  xirr: number | null; // Annualized return rate (XIRR)
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
  xirr: number | null; // Portfolio XIRR
  avg_capital_deployed_usd: number; // Average capital deployed over the period
  apr: number | null; // Annualized percentage return
  days_active: number; // Number of days in the period
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
  daily_income_usd: number; // fees + rewards collected that day (not full profit - doesn't account for IL/price changes)
  capital_deployed_usd: number; // Net capital deployed at end of day (cumulative deposits - withdrawals)
}

interface CashFlow {
  date: Date;
  amount: number; // negative for outflows (deposits), positive for inflows (withdrawals, fees, rewards)
}

// Calculate XIRR (Extended Internal Rate of Return) using Newton-Raphson method
// Returns annualized rate as a percentage (e.g., 15.5 for 15.5% APR)
function calculateXIRR(cashFlows: CashFlow[], maxIterations = 100, tolerance = 1e-6): number | null {
  if (cashFlows.length < 2) {
    return null; // Need at least 2 cash flows
  }

  // Sort by date
  const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // Check if we have both inflows and outflows
  const hasOutflow = sorted.some(cf => cf.amount < 0);
  const hasInflow = sorted.some(cf => cf.amount > 0);
  
  if (!hasOutflow || !hasInflow) {
    return null; // Need both deposits and returns
  }

  const firstDate = sorted[0].date.getTime();
  
  // Calculate days from first cash flow for each transaction
  const daysFromStart = sorted.map(cf => (cf.date.getTime() - firstDate) / (1000 * 60 * 60 * 24));
  
  // Initial guess: 10% annualized
  let rate = 0.1;
  
  // Newton-Raphson iteration
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0; // Derivative of NPV
    
    for (let j = 0; j < sorted.length; j++) {
      const years = daysFromStart[j] / 365;
      const discountFactor = Math.pow(1 + rate, -years);
      
      npv += sorted[j].amount * discountFactor;
      dnpv += -years * sorted[j].amount * discountFactor / (1 + rate);
    }
    
    // Check convergence
    if (Math.abs(npv) < tolerance) {
      return rate * 100; // Convert to percentage
    }
    
    // Newton-Raphson update
    if (dnpv === 0) {
      return null; // Can't converge
    }
    
    rate = rate - npv / dnpv;
    
    // Prevent rate from going too negative or too high
    if (rate < -0.99) rate = -0.99;
    if (rate > 10) rate = 10; // Cap at 1000% to prevent overflow
  }
  
  // If we didn't converge, return null
  return null;
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
  
  // Calculate profit and impermanent loss
  let profit_usd = 0;
  let impermanent_loss_usd = 0;
  
  if (first_mint && first_burn) {
    const hodlValueAtDepositUSD = total_deposit_usd; // Deposit valued at time of deposit
    const lpValueAtExitUSD = total_withdraw_usd;      // Withdraw valued at time of withdrawal
    
    // Calculate HODL value at exit (for IL calculation)
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
    if (burns.length > 0) {
      impermanent_loss_usd = lpValueAtExitUSD - hodlValueAtExitUSD;
      
    }
    
    // Profit = (LP value at exit - HODL value at deposit) + rewards
    // This includes: IL + HODL_gain + fees + rewards
    const collectedRewardsAmountUSD = total_aero_rewards_usd;
    profit_usd = (lpValueAtExitUSD - hodlValueAtDepositUSD) + collectedRewardsAmountUSD;
  }
  
  // Calculate XIRR (Extended Internal Rate of Return)
  // Build cash flows: deposits are negative (outflows), returns are positive (inflows)
  const cashFlows: CashFlow[] = [];
  
  // Add mints as negative cash flows (capital deployed)
  mints.forEach(mint => {
    cashFlows.push({
      date: new Date(mint.timestamp),
      amount: -(mint.amount0_usd + mint.amount1_usd),
    });
  });
  
  // Add burns as positive cash flows (capital returned)
  burns.forEach(burn => {
    cashFlows.push({
      date: new Date(burn.timestamp),
      amount: burn.amount0_usd + burn.amount1_usd,
    });
  });
  
  // Add fee collections as positive cash flows (income)
  collects.forEach(collect => {
    const feeValue = collect.fee0_dec + (collect.fee1_dec * collect.cbBTC_price);
    if (feeValue > 0) {
      cashFlows.push({
        date: new Date(collect.timestamp),
        amount: feeValue,
      });
    }
  });
  
  // Add AERO rewards as positive cash flows (income) - excluding gauge_getReward
  rows
    .filter(r => r.action !== "gauge_getReward" && r.AERO_usd > 0)
    .forEach(row => {
      cashFlows.push({
        date: new Date(row.timestamp),
        amount: row.AERO_usd,
      });
    });
  
  // Calculate XIRR
  const xirr = calculateXIRR(cashFlows);
  
  return {
    token_id,
    events_count: rows.length,
    mint_count: mints.length,
    first_mint_timestamp: first_mint ? new Date(first_mint.timestamp) : null,
    total_deposit_usdc,
    total_deposit_cbbtc,
    total_deposit_usd,
    btc_price_at_first_mint,
    burn_count: burns.length,
    first_burn_timestamp: first_burn ? new Date(first_burn.timestamp) : null,
    total_withdraw_usdc,
    total_withdraw_cbbtc,
    total_withdraw_usd,
    btc_price_at_first_burn,
    total_fees_usd,
    total_aero_rewards,
    active_time_seconds,
    impermanent_loss_usd,
    profit_usd,
    xirr,
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
    
    const daily_income_usd = fees_collected_usd + aero_rewards_collected;
    
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
      daily_income_usd,
      capital_deployed_usd: 0,
    });
  }
  
  // Sort by date
  dailyStats.sort((a, b) => a.date.localeCompare(b.date));
  
  // Calculate cumulative capital deployed for each day
  let cumulativeCapital = 0;
  for (const day of dailyStats) {
    cumulativeCapital += day.deposit_value_usd - day.withdraw_value_usd;
    day.capital_deployed_usd = cumulativeCapital;
  }
  
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
  
  // Read the analysis CSV from command line or default location
  const args = process.argv.slice(2);
  let csvPath: string;
  let summaryOutputPath: string;
  let dailyOutputPath: string;
  let walletType: "copywallet" | "targetwallet" = "copywallet";
  
  if (args.length >= 3) {
    // Batch mode or explicit paths provided
    csvPath = args[0];
    summaryOutputPath = args[1];
    dailyOutputPath = args[2];
  } else {
    // Default mode: use copywallet-comparison structure
    // Check if user specified targetwallet or copywallet (default: copywallet)
    if (args.length === 1 && (args[0] === "targetwallet" || args[0] === "copywallet")) {
      walletType = args[0];
    }
    
    // Auto-detect addresses from folder names
    const targetwalletBaseDir = path.join(__dirname, "..", "input", "copywallet-comparison", "targetwallet");
    
    if (!fs.existsSync(targetwalletBaseDir)) {
      console.error("Error: Input directory not found: input/copywallet-comparison/targetwallet/");
      console.error("Please create the directory structure.");
      process.exit(1);
    }
    
    // Find address folder
    const targetwalletAddressDirs = fs.readdirSync(targetwalletBaseDir).filter(f => {
      const fullPath = path.join(targetwalletBaseDir, f);
      return fs.statSync(fullPath).isDirectory() && f.startsWith("0x");
    });
    
    if (targetwalletAddressDirs.length === 0) {
      console.error("Error: No address folder found in input/copywallet-comparison/targetwallet/");
      console.error("Please create a folder with the targetwallet address containing the CSV files.");
      process.exit(1);
    }
    
    const targetwalletAddr = targetwalletAddressDirs[0];
    const targetwalletInputDir = path.join(targetwalletBaseDir, targetwalletAddr);
    const targetwalletFiles = fs.readdirSync(targetwalletInputDir);
    const targetActionsFile = targetwalletFiles.find(f => f.startsWith("actions_") && f.endsWith(".csv"));
    
    let blockRange = "unknown";
    if (targetActionsFile) {
      const match = targetActionsFile.match(/blocks_(\d+)_(\d+)/);
      if (match) {
        blockRange = `${match[1]}_${match[2]}`;
      }
    }
    
    // Create subdirectory: {targetAddress}_{blockRange}/
    const sessionDir = `${targetwalletAddr}_${blockRange}`;
    const baseOutputDir = path.join(__dirname, "..", "output", "copywallet-comparison", sessionDir);
    const outputBaseDir = path.join(baseOutputDir, walletType);
    
    // Ensure output directory exists
    if (!fs.existsSync(outputBaseDir)) {
      fs.mkdirSync(outputBaseDir, { recursive: true });
    }
    
    // Find the transaction_details file
    if (!fs.existsSync(outputBaseDir)) {
      console.error(`Error: Output directory not found: ${outputBaseDir}`);
      console.error(`Please run 'npm start ${walletType}' first to generate transaction details.`);
      process.exit(1);
    }
    
    const files = fs.readdirSync(outputBaseDir);
    const transactionFile = files.find(f => f.startsWith("transaction_details_") && f.endsWith(".csv"));
    
    if (!transactionFile) {
      console.error(`Error: Missing transaction_details_*.csv in ${outputBaseDir}`);
      console.error(`Please run 'npm start ${walletType}' first to generate transaction details.`);
      process.exit(1);
    }
    
    csvPath = path.join(outputBaseDir, transactionFile);
    
    // Extract label from filename
    const label = transactionFile.replace("transaction_details_", "").replace(".csv", "");
    summaryOutputPath = path.join(outputBaseDir, `analysis_by_position_${label}.csv`);
    dailyOutputPath = path.join(outputBaseDir, `analysis_by_day_${label}.csv`);
    
    console.log(`Analyzing ${walletType}...`);
  }
  
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
  
  // Report position breakdown
  const completePositionsCount = positionStats.filter(p => p.mint_count > 0 && p.burn_count > 0).length;
  const preExistingCount = positionStats.filter(p => p.mint_count === 0 && p.burn_count > 0).length;
  const unclosedPositionsCount = positionStats.filter(p => p.mint_count > 0 && p.burn_count === 0).length;
  const excludedCount = preExistingCount + unclosedPositionsCount;
  
  console.log(`\nPosition Breakdown: ${completePositionsCount} complete, ${excludedCount} excluded`);
  if (preExistingCount > 0) {
    console.log(`    ${preExistingCount} pre-existing position(s) (opened before observation) excluded`);
  }
  if (unclosedPositionsCount > 0) {
    console.log(`    ${unclosedPositionsCount} unclosed position(s) (still open) excluded`);
  }
  
  // Calculate daily stats
  console.log("\n" + "=".repeat(60));
  console.log("CALCULATING DAILY STATISTICS");
  console.log("=".repeat(60) + "\n");
  
  // Filter rows to only include events from COMPLETE positions (both opened AND closed during observation)
  const completePositionTokenIds = new Set(
    positionStats.filter(p => p.mint_count > 0 && p.burn_count > 0).map(p => p.token_id)
  );
  const rowsFromCompletePositions = rows.filter(r => 
    !r.token_id || r.token_id === "" || completePositionTokenIds.has(r.token_id)
  );
  
  const dailyStats = calculateDailyStats(rowsFromCompletePositions);
  console.log(`Calculated stats for ${dailyStats.length} days (using ${rowsFromCompletePositions.length} events from complete positions only)\n`);
  
  // Calculate wallet-level aggregated stats
  const allAeroRewardsUsd = rowsFromCompletePositions.reduce((sum, r) => sum + r.AERO_usd, 0);
  
  // Calculate average capital deployed from COMPLETE positions only
  const completePositionsOnly = positionStats.filter(p => p.mint_count > 0 && p.burn_count > 0);
  const totalDepositsCompletePositions = completePositionsOnly.reduce((sum, p) => sum + p.total_deposit_usd, 0);
  const totalWithdrawalsCompletePositions = completePositionsOnly.reduce((sum, p) => sum + p.total_withdraw_usd, 0);
  
  // Avg capital = average of what was deployed across the period
  // Simple approximation: (total deposits + total withdrawals) / 2
  const avg_capital_deployed_usd = completePositionsOnly.length > 0
    ? (totalDepositsCompletePositions + totalWithdrawalsCompletePositions) / 2
    : 0;
  
  // Calculate actual operating time from earliest to latest transaction (complete positions only)
  let days_active = dailyStats.length;
  if (rowsFromCompletePositions.length >= 2) {
    const timestamps = rowsFromCompletePositions.map(r => new Date(r.timestamp).getTime());
    const earliestTimestamp = Math.min(...timestamps);
    const latestTimestamp = Math.max(...timestamps);
    const actualMilliseconds = latestTimestamp - earliestTimestamp;
    days_active = actualMilliseconds / (1000 * 60 * 60 * 24); // Convert to days
    
    // Ensure we have a minimum time period to avoid division by zero or unrealistic APRs
    if (days_active < 0.001) {
      days_active = dailyStats.length;
    }
  }
  
  // Filter to only complete positions (both opened AND closed) for wallet-level calculations
  const completePositions = positionStats.filter(p => p.mint_count > 0 && p.burn_count > 0);
  
  const walletStats: WalletStats = {
    positions_count: completePositions.length,
    events_count: rowsFromCompletePositions.length,
    total_deposit_usdc: completePositions.reduce((sum, p) => sum + p.total_deposit_usdc, 0),
    total_deposit_cbbtc: completePositions.reduce((sum, p) => sum + p.total_deposit_cbbtc, 0),
    total_withdraw_usdc: completePositions.reduce((sum, p) => sum + p.total_withdraw_usdc, 0),
    total_withdraw_cbbtc: completePositions.reduce((sum, p) => sum + p.total_withdraw_cbbtc, 0),
    avg_active_time_seconds: completePositions.length > 0
      ? completePositions.reduce((sum, p) => sum + p.active_time_seconds, 0) / completePositions.length
      : 0,
    total_fees_usd: completePositions.reduce((sum, p) => sum + p.total_fees_usd, 0),
    total_collected_aero_rewards: completePositions.reduce((sum, p) => sum + p.total_aero_rewards, 0),
    total_collected_aero_rewards_usd: allAeroRewardsUsd,
    total_impermanent_loss_usd: completePositions.reduce((sum, p) => sum + p.impermanent_loss_usd, 0),
    total_profit_usd: completePositions.reduce((sum, p) => sum + p.profit_usd, 0),
    xirr: null,
    avg_capital_deployed_usd,
    apr: null,
    days_active,
  };
  
  // Add gauge_getReward rewards to token count (wallet-level, not position-specific)
  const gaugeRewards = rowsFromCompletePositions
    .filter(r => r.action === "gauge_getReward")
    .reduce((sum, e) => sum + e.reward, 0);
  walletStats.total_collected_aero_rewards += gaugeRewards;
  
  // Add gauge_getReward AERO rewards (USD) to wallet profit
  const gaugeRewardsUsd = rowsFromCompletePositions
    .filter(r => r.action === "gauge_getReward")
    .reduce((sum, e) => sum + e.AERO_usd, 0);
  walletStats.total_profit_usd += gaugeRewardsUsd;
  
  const walletCashFlows: CashFlow[] = [];
  
  // Add all mints as negative cash flows
  rowsFromCompletePositions.filter(r => r.action === "mint").forEach(mint => {
    walletCashFlows.push({
      date: new Date(mint.timestamp),
      amount: -(mint.amount0_usd + mint.amount1_usd),
    });
  });
  
  // Add all burns as positive cash flows
  rowsFromCompletePositions.filter(r => r.action === "burn").forEach(burn => {
    walletCashFlows.push({
      date: new Date(burn.timestamp),
      amount: burn.amount0_usd + burn.amount1_usd,
    });
  });
  
  // Add all fee collections as positive cash flows
  rowsFromCompletePositions.filter(r => r.action === "collect").forEach(collect => {
    const feeValue = collect.fee0_dec + (collect.fee1_dec * collect.cbBTC_price);
    if (feeValue > 0) {
      walletCashFlows.push({
        date: new Date(collect.timestamp),
        amount: feeValue,
      });
    }
  });
  
  // Add all AERO rewards as positive cash flows
  rowsFromCompletePositions.filter(r => r.AERO_usd > 0).forEach(row => {
    walletCashFlows.push({
      date: new Date(row.timestamp),
      amount: row.AERO_usd,
    });
  });
  
  // Calculate wallet XIRR
  walletStats.xirr = calculateXIRR(walletCashFlows);
  
  // Calculate APR (simple annualized return)
  // Use average deposit per position to account for capital recycling
  const avgDepositPerPosition = walletStats.positions_count > 0 
    ? totalDepositsCompletePositions / walletStats.positions_count
    : 0;
  
  if (avgDepositPerPosition > 0 && walletStats.days_active > 0) {
    const periodReturn = walletStats.total_profit_usd / avgDepositPerPosition;
    walletStats.apr = (periodReturn * 365 / walletStats.days_active) * 100; // Convert to percentage
  }
  
  // Calculate net position changes
  const usdcChange = walletStats.total_withdraw_usdc - walletStats.total_deposit_usdc;
  const cbbtcChange = walletStats.total_withdraw_cbbtc - walletStats.total_deposit_cbbtc;
  
  // Ensure output directory exists
  const outputDir = path.dirname(summaryOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Generate combined summary CSV with COMPLETE positions only + wallet summary at the end
  // Pre-existing and unclosed positions are filtered out from the analysis files
  const combinedCsvData = [
    ...completePositions.map(pos => ({
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
      deposit_value_usd: pos.total_deposit_usd,
      total_withdraw_usdc: pos.total_withdraw_usdc,
      total_withdraw_cbbtc: pos.total_withdraw_cbbtc,
      btc_price_at_withdrawal: pos.btc_price_at_first_burn,
      withdrawal_value_usd: pos.total_withdraw_usd,
      net_usdc_change: "",
      net_cbbtc_change: "",
      total_fees_usd: pos.total_fees_usd,
      impermanent_loss_usd: pos.impermanent_loss_usd,
      profit_usd: pos.profit_usd,
      xirr: pos.xirr !== null ? pos.xirr : "",
    })),
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
      deposit_value_usd: completePositions.reduce((sum, p) => sum + p.total_deposit_usd, 0),
      total_withdraw_usdc: walletStats.total_withdraw_usdc,
      total_withdraw_cbbtc: walletStats.total_withdraw_cbbtc,
      btc_price_at_withdrawal: "",
      withdrawal_value_usd: completePositions.reduce((sum, p) => sum + p.total_withdraw_usd, 0),
      net_usdc_change: usdcChange,
      net_cbbtc_change: cbbtcChange,
      total_fees_usd: walletStats.total_fees_usd,
      impermanent_loss_usd: walletStats.total_impermanent_loss_usd,
      profit_usd: walletStats.total_profit_usd,
      xirr: walletStats.xirr !== null ? walletStats.xirr : "",
    }
  ];
  
  const combinedCsv = stringify(combinedCsvData, {
    header: true,
  });
  
  fs.writeFileSync(summaryOutputPath, combinedCsv, "utf-8");
  
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
    daily_income_usd: dailyStats.reduce((sum, d) => sum + d.daily_income_usd, 0),
  };
  
  const dailyCsvData = [...dailyStats, dailySummary];
  const dailyCsv = stringify(dailyCsvData, {
    header: true,
  });
  
  fs.writeFileSync(dailyOutputPath, dailyCsv, "utf-8");
  
  const formatOperatingTime = (days: number): string => {
    const totalHours = days * 24;
    const hours = Math.floor(totalHours);
    const minutes = Math.floor((totalHours - hours) * 60);
    const seconds = Math.floor(((totalHours - hours) * 60 - minutes) * 60);
    
    if (hours > 24) {
      const displayDays = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${displayDays}d ${remainingHours}h ${minutes}m`;
    }
    return `${hours}h ${minutes}m ${seconds}s`;
  };
  
  const excludedPositionCount = positionStats.length - completePositions.length;
  
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Complete Positions:  ${walletStats.positions_count}` + (excludedPositionCount > 0 ? ` (${excludedPositionCount} excluded: ${preExistingCount} pre-existing, ${unclosedPositionsCount} still open)` : ''));
  console.log(`Total Events:        ${walletStats.events_count}`);
  console.log(`Operating Time:      ${formatOperatingTime(walletStats.days_active)} (${walletStats.days_active.toFixed(4)} days)`);
  console.log(`Avg Capital Deployed: $${walletStats.avg_capital_deployed_usd.toFixed(2)}`);
  console.log(`Total Fees:          $${walletStats.total_fees_usd.toFixed(2)}`);
  console.log(`AERO Rewards:        ${walletStats.total_collected_aero_rewards.toFixed(4)} AERO ($${walletStats.total_collected_aero_rewards_usd.toFixed(2)})`);
  console.log(`Impermanent Loss:    $${walletStats.total_impermanent_loss_usd.toFixed(2)}`);
  console.log(`Total Profit:        $${walletStats.total_profit_usd.toFixed(2)}`);
  console.log(`APR:                 ${walletStats.apr !== null ? walletStats.apr.toFixed(2) + '%' : 'N/A'}`);
  console.log(`Portfolio XIRR:      ${walletStats.xirr !== null ? walletStats.xirr.toFixed(2) + '%' : 'N/A'}`);
  console.log("=".repeat(60));
  console.log(`\n✓ Position analysis written to: ${summaryOutputPath}`);
  console.log(`✓ Daily analysis written to: ${dailyOutputPath}`);
  console.log("\nDone!");
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

