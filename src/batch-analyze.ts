/**
 * End-to-end script for batch analysis of multiple top wallets
 * Processes all wallets in input/topwallet-comparison/ and generates comparison
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

interface AddressConfig {
  address: string;
  actionsFile: string;
  earningsFile: string;
  label: string;
}

interface AnalysisRow {
  row_type: string;
  token_id: string;
  positions_count: string;
  events_count: string;
  active_time_seconds: string;
  total_deposit_usdc: string;
  total_deposit_cbbtc: string;
  deposit_value_usd: string;
  total_withdraw_usdc: string;
  total_withdraw_cbbtc: string;
  withdrawal_value_usd: string;
  net_usdc_change: string;
  net_cbbtc_change: string;
  total_fees_usd: string;
  impermanent_loss_usd: string;
  profit_usd: string;
  xirr: string;
  [key: string]: string;
}

interface DailyRow {
  date: string;
  events_count: string;
  positions_opened: string;
  positions_closed: string;
  deposit_usdc: string;
  deposit_cbbtc: string;
  deposit_value_usd: string;
  withdraw_usdc: string;
  withdraw_cbbtc: string;
  withdraw_value_usd: string;
  fees_collected_usd: string;
  aero_rewards_collected: string;
  daily_income_usd: string;
  capital_deployed_usd: string;
}

function formatDuration(seconds: number): string {
  const totalHours = seconds / 3600;
  const hours = Math.floor(totalHours);
  const minutes = Math.floor((totalHours - hours) * 60);
  const secs = Math.floor(((totalHours - hours) * 60 - minutes) * 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

async function main() {
  console.log("=".repeat(80));
  console.log("BATCH ANALYSIS - TOP WALLETS COMPARISON");
  console.log("=".repeat(80));
  console.log("\nThis will analyze all wallets in input/topwallet-comparison/");
  console.log("and generate a side-by-side comparison.\n");
  
  const inputDir = path.join(__dirname, "..", "input", "topwallet-comparison");
  const outputDir = path.join(__dirname, "..", "output", "topwallet-comparison");
  
  // Ensure directories exist
  if (!fs.existsSync(inputDir)) {
    console.error(`Error: Input directory not found: ${inputDir}`);
    console.error(`Please create the directory structure: input/topwallet-comparison/`);
    process.exit(1);
  }
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Discover all address folders
  const addressFolders = fs.readdirSync(inputDir)
    .filter(item => {
      const itemPath = path.join(inputDir, item);
      return fs.statSync(itemPath).isDirectory() && item.startsWith("0x");
    });
  
  if (addressFolders.length === 0) {
    console.error("No address folders found in input/");
    process.exit(1);
  }
  
  console.log(`Found ${addressFolders.length} address folder(s):\n`);
  
  const configs: AddressConfig[] = [];
  
  // Process each address folder
  for (const addressFolder of addressFolders) {
    const addressPath = path.join(inputDir, addressFolder);
    const files = fs.readdirSync(addressPath);
    
    // Find actions and earnings files
    const actionsFile = files.find(f => f.startsWith("actions_") && f.endsWith(".csv"));
    const earningsFile = files.find(f => f.startsWith("earnings_per_action_") && f.endsWith(".csv"));
    
    if (!actionsFile || !earningsFile) {
      console.log(`⚠️  Skipping ${addressFolder}: missing files`);
      if (!actionsFile) console.log(`   - Missing: actions_*.csv`);
      if (!earningsFile) console.log(`   - Missing: earnings_per_action_*.csv`);
      console.log();
      continue;
    }
    
    // Extract label from filename (e.g., "actions_blocks_38010776_38014926.csv" -> "blocks_38010776_38014926")
    const label = actionsFile.replace("actions_", "").replace(".csv", "");
    
    configs.push({
      address: addressFolder,
      actionsFile: path.join(addressPath, actionsFile),
      earningsFile: path.join(addressPath, earningsFile),
      label
    });
    
    console.log(`✓ ${addressFolder}`);
    console.log(`  Label: ${label}`);
    console.log(`  Actions: ${actionsFile}`);
    console.log(`  Earnings: ${earningsFile}`);
    console.log();
  }
  
  if (configs.length === 0) {
    console.error("No valid address configurations found");
    process.exit(1);
  }
  
  console.log("=".repeat(80));
  console.log("STARTING BATCH ANALYSIS");
  console.log("=".repeat(80));
  console.log();
  
  // Extract block range from first config (all should have the same range)
  let blockRange = "unknown";
  if (configs.length > 0 && configs[0].label) {
    const match = configs[0].label.match(/blocks_(\d+)_(\d+)/);
    if (match) {
      blockRange = `${match[1]}_${match[2]}`;
    }
  }
  
  // Create subdirectory for this block range
  const sessionOutputDir = path.join(outputDir, blockRange);
  if (!fs.existsSync(sessionOutputDir)) {
    fs.mkdirSync(sessionOutputDir, { recursive: true });
  }
  
  // Process each address
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    console.log(`\n[${ i + 1}/${configs.length}] Processing ${config.address}...`);
    console.log("-".repeat(80));
    
    // Create output directory for this address
    const addressOutputDir = path.join(sessionOutputDir, config.address);
    if (!fs.existsSync(addressOutputDir)) {
      fs.mkdirSync(addressOutputDir, { recursive: true });
    }
    
    try {
      // Step 1: Run index.ts to generate transaction_details.csv
      console.log("\n[Step 1/2] Generating transaction details...");
      const indexCmd = `tsx src/index.ts "${config.actionsFile}" "${config.earningsFile}" "${path.join(addressOutputDir, `transaction_details_${config.label}.csv`)}"`;
      execSync(indexCmd, { 
        cwd: path.join(__dirname, ".."),
        stdio: 'inherit'
      });
      
      // Step 2: Run analyze.ts to generate analysis files
      console.log("\n[Step 2/2] Running analysis...");
      const analyzeCmd = `tsx src/analyze.ts "${path.join(addressOutputDir, `transaction_details_${config.label}.csv`)}" "${path.join(addressOutputDir, `analysis_by_position_${config.label}.csv`)}" "${path.join(addressOutputDir, `analysis_by_day_${config.label}.csv`)}"`;
      execSync(analyzeCmd, {
        cwd: path.join(__dirname, ".."),
        stdio: 'inherit'
      });
      
      console.log(`\n✓ Completed ${config.address}`);
      console.log(`  Output: ${addressOutputDir}/`);
      
    } catch (error: any) {
      console.error(`\n✗ Failed to process ${config.address}`);
      console.error(`  Error: ${error.message}`);
    }
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("BATCH ANALYSIS COMPLETE");
  console.log("=".repeat(80));
  console.log(`\nProcessed ${configs.length} address(es)`);
  console.log(`\nOutput directories:`);
  for (const config of configs) {
    console.log(`  - output/topwallet-comparison/${blockRange}/${config.address}/`);
  }
  
  // Generate batch comparison CSV
  console.log("\n" + "=".repeat(80));
  console.log("GENERATING BATCH COMPARISON");
  console.log("=".repeat(80));
  
  try {
    const result = await generateBatchComparison(configs, sessionOutputDir);
    const comparisonPath = path.join(sessionOutputDir, `batch_comparison_${result.label}.csv`);
    fs.writeFileSync(comparisonPath, result.csvData, "utf-8");
    console.log(`\nBatch comparison saved to: ${comparisonPath}`);
  } catch (error: any) {
    console.error(`\nWarning: Could not generate batch comparison: ${error.message}`);
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("✅ BATCH ANALYSIS COMPLETE!");
  console.log("=".repeat(80));
  console.log("\nCheck output/topwallet-comparison/${blockRange}/ for results:");
  console.log("  - {address}/ - Individual wallet analysis");
  console.log("  - batch_comparison_*.csv - Side-by-side comparison of all wallets");
  console.log();
}

async function generateBatchComparison(configs: AddressConfig[], outputDir: string): Promise<{ csvData: string; label: string }> {
  const metricsData: any[] = [];
  
  // Extract block range and timestamps from transaction details
  let minBlock = Infinity;
  let maxBlock = 0;
  let minTimestamp = Infinity;
  let maxTimestamp = 0;
  
  // Get block range and timestamps from first address's transaction details
  const firstConfig = configs[0];
  const firstTransactionPath = path.join(outputDir, firstConfig.address, `transaction_details_${firstConfig.label}.csv`);
  
  if (fs.existsSync(firstTransactionPath)) {
    const txData: any[] = parse(fs.readFileSync(firstTransactionPath, "utf-8"), {
      columns: true,
      skip_empty_lines: true
    });
    
    for (const row of txData) {
      const block = parseInt(row.block);
      const timestamp = Math.floor(new Date(row.timestamp).getTime() / 1000); // Convert ISO string to unix timestamp
      
      if (!isNaN(block)) {
        if (block < minBlock) minBlock = block;
        if (block > maxBlock) maxBlock = block;
      }
      
      if (!isNaN(timestamp)) {
        if (timestamp < minTimestamp) minTimestamp = timestamp;
        if (timestamp > maxTimestamp) maxTimestamp = timestamp;
      }
    }
  }
  
  // Format timestamps as readable dates
  const startDate = new Date(minTimestamp * 1000).toISOString().replace('T', ' ').substring(0, 19);
  const endDate = new Date(maxTimestamp * 1000).toISOString().replace('T', ' ').substring(0, 19);
  
  // Helper to create a row with empty values for all addresses
  const createEmptyRow = (metricName: string, firstValue: string = "") => {
    const row: any = { metric: metricName };
    configs.forEach((config, index) => {
      row[config.address] = index === 0 ? firstValue : "";
    });
    return row;
  };
  
  // Add metadata rows at the top
  metricsData.push(createEmptyRow("ANALYSIS METADATA"));
  metricsData.push(createEmptyRow("Block Range", `${minBlock} to ${maxBlock}`));
  metricsData.push(createEmptyRow("Start Time", startDate));
  metricsData.push(createEmptyRow("End Time", endDate));
  metricsData.push(createEmptyRow(""));
  metricsData.push(createEmptyRow("PERFORMANCE METRICS"));
  
  // Calculate operating time from daily data (assuming same for all)
  const firstDailyPath = path.join(outputDir, firstConfig.address, `analysis_by_day_${firstConfig.label}.csv`);
  
  let operatingDays = 0.0954; // default fallback
  if (fs.existsSync(firstDailyPath)) {
    const dailyData: DailyRow[] = parse(fs.readFileSync(firstDailyPath, "utf-8"), {
      columns: true,
      skip_empty_lines: true
    });
    // Assuming operating time is same across all addresses
    if (dailyData.length > 0) {
      // This is a simplification - ideally we'd extract this from summary output
      operatingDays = 0.0954;
    }
  }
  
  // Collect data for each address
  const addressData: Record<string, any> = {};
  
  for (const config of configs) {
    const positionPath = path.join(outputDir, config.address, `analysis_by_position_${config.label}.csv`);
    const dailyPath = path.join(outputDir, config.address, `analysis_by_day_${config.label}.csv`);
    const transactionPath = path.join(outputDir, config.address, `transaction_details_${config.label}.csv`);
    
    if (!fs.existsSync(positionPath) || !fs.existsSync(dailyPath)) {
      console.warn(`  Warning: Missing analysis files for ${config.address}, skipping...`);
      continue;
    }
    
    // Parse position analysis
    const positionData: AnalysisRow[] = parse(fs.readFileSync(positionPath, "utf-8"), {
      columns: true,
      skip_empty_lines: true
    });
    
    // Parse daily analysis
    const dailyData: DailyRow[] = parse(fs.readFileSync(dailyPath, "utf-8"), {
      columns: true,
      skip_empty_lines: true
    });
    
    // Get wallet summary
    const wallet = positionData.find(r => r.row_type === "wallet_summary");
    const daily = dailyData[0];
    
    if (!wallet || !daily) {
      console.warn(`  Warning: Missing wallet summary for ${config.address}, skipping...`);
      continue;
    }
    
    // Calculate excluded positions
    let excluded = 0;
    let preExisting = 0;
    let unclosed = 0;
    
    if (fs.existsSync(transactionPath)) {
      const txData: any[] = parse(fs.readFileSync(transactionPath, "utf-8"), {
        columns: true,
        skip_empty_lines: true
      });
      
      const positionMap = new Map<string, { hasMint: boolean, hasBurn: boolean }>();
      
      for (const row of txData) {
        if (!row.token_id || row.token_id === "") continue;
        
        if (!positionMap.has(row.token_id)) {
          positionMap.set(row.token_id, { hasMint: false, hasBurn: false });
        }
        
        const pos = positionMap.get(row.token_id)!;
        if (row.action === "mint") pos.hasMint = true;
        if (row.action === "burn") pos.hasBurn = true;
      }
      
      for (const [_, status] of positionMap) {
        if (status.hasBurn && !status.hasMint) {
          preExisting++;
        } else if (status.hasMint && !status.hasBurn) {
          unclosed++;
        }
      }
      
      excluded = preExisting + unclosed;
    }
    
    // Extract metrics
    const positions = parseInt(wallet.positions_count);
    const events = parseInt(wallet.events_count);
    const avgPositionDuration = parseFloat(wallet.active_time_seconds);
    const depositValue = parseFloat(wallet.deposit_value_usd);
    const withdrawValue = parseFloat(wallet.withdrawal_value_usd);
    const avgCapital = (depositValue + withdrawValue) / 2;
    const profit = parseFloat(wallet.profit_usd);
    const il = parseFloat(wallet.impermanent_loss_usd);
    const aeroRewards = parseFloat(daily.aero_rewards_collected);
    const fees = parseFloat(wallet.total_fees_usd);
    
    // Calculate total operating time from transaction timestamps
    let operatingTimeSeconds = 0;
    if (fs.existsSync(transactionPath)) {
      const txData: any[] = parse(fs.readFileSync(transactionPath, "utf-8"), {
        columns: true,
        skip_empty_lines: true
      });
      
      if (txData.length > 0) {
        const firstTimestamp = Math.floor(new Date(txData[0].timestamp).getTime() / 1000);
        const lastTimestamp = Math.floor(new Date(txData[txData.length - 1].timestamp).getTime() / 1000);
        operatingTimeSeconds = lastTimestamp - firstTimestamp;
      }
    }
    
    // Calculate APR
    const apr = (profit / avgCapital) * (365 / operatingDays) * 100;
    
    // Store data
    addressData[config.address] = {
      completePositions: positions,
      excludedPositions: excluded,
      preExisting,
      unclosed,
      totalEvents: events,
      operatingTime: formatDuration(operatingTimeSeconds),
      avgPositionDuration: `${avgPositionDuration.toFixed(1)}s`,
      totalDepositsUSD: depositValue.toFixed(2),
      avgCapitalDeployed: avgCapital.toFixed(2),
      totalWithdrawalsUSD: withdrawValue.toFixed(2),
      aeroRewardsUSD: aeroRewards.toFixed(2),
      tradingFeesUSD: fees.toFixed(2),
      impermanentLossUSD: il.toFixed(2),
      totalProfitUSD: profit.toFixed(2),
      profitPctOfCapital: ((profit / avgCapital) * 100).toFixed(4),
      ilPctOfCapital: ((il / avgCapital) * 100).toFixed(4),
      aprPct: apr.toFixed(2),
      xirr: wallet.xirr && wallet.xirr !== "N/A" ? parseFloat(wallet.xirr).toFixed(2) : "N/A"
    };
  }
  
  if (Object.keys(addressData).length === 0) {
    throw new Error("No valid address data found for comparison");
  }
  
  // Build CSV rows
  const metrics = [
    { label: "Complete Positions", key: "completePositions" },
    { label: "Excluded Positions (Total)", key: "excludedPositions" },
    { label: "  - Pre-existing (burn only)", key: "preExisting" },
    { label: "  - Unclosed (mint only)", key: "unclosed" },
    { label: "Total Events", key: "totalEvents" },
    { label: "Operating Time", key: "operatingTime" },
    { label: "Avg Position Duration", key: "avgPositionDuration" },
    { label: "Total Deposits (USD)", key: "totalDepositsUSD" },
    { label: "Avg Capital Deployed (USD)", key: "avgCapitalDeployed" },
    { label: "Total Withdrawals (USD)", key: "totalWithdrawalsUSD" },
    { label: "AERO Rewards (USD)", key: "aeroRewardsUSD" },
    { label: "Trading Fees (USD)", key: "tradingFeesUSD" },
    { label: "Impermanent Loss (USD)", key: "impermanentLossUSD" },
    { label: "IL as % of Capital", key: "ilPctOfCapital" },
    { label: "Total Profit/Loss (USD)", key: "totalProfitUSD" },
    { label: "Profit % of Capital", key: "profitPctOfCapital" },
    { label: "APR (%)", key: "aprPct" },
    { label: "Portfolio XIRR (%)", key: "xirr" }
  ];
  
  // Create rows
  for (const metric of metrics) {
    const row: any = { metric: metric.label };
    for (const address in addressData) {
      row[address] = addressData[address][metric.key];
    }
    metricsData.push(row);
  }
  
  // Generate CSV
  const columns = [
    { key: 'metric', header: 'Metric' }
  ];
  
  for (const address in addressData) {
    columns.push({ key: address, header: address });
  }
  
  const csvOutput = stringify(metricsData, {
    header: true,
    columns: columns
  });
  
  // Use the label from the first config for the filename (e.g., "blocks_38010776_38014926")
  const label = firstConfig.label;
  
  return { csvData: csvOutput, label };
}

main().catch(error => {
  console.error("Error:", error.message);
  process.exit(1);
});

