/**
 * End-to-end script to compare copywallet vs targetwallet
 * Processes both wallets and generates a comparison report
 */

import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { execSync } from "child_process";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

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

function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  });
}

function formatDuration(days: number): string {
  const totalHours = days * 24;
  const hours = Math.floor(totalHours);
  const minutes = Math.floor((totalHours - hours) * 60);
  const seconds = Math.floor(((totalHours - hours) * 60 - minutes) * 60);
  return `${hours}h ${minutes}m ${seconds}s`;
}

function calculateRatio(val1: number, val2: number): string {
  if (val2 === 0) return "N/A";
  const ratio = val1 / val2;
  if (ratio >= 1000) return `${formatNumber(ratio, 0)}x`;
  if (ratio >= 10) return `${formatNumber(ratio, 0)}x`;
  if (ratio >= 1) return `${formatNumber(ratio, 2)}x`;
  if (ratio >= 0.01) return `${formatNumber(ratio, 2)}x`;
  // For very small ratios, show with 8 decimal places to preserve precision
  if (ratio < 0.01 && ratio > 0) return `${ratio.toFixed(8)}x`;
  return `${formatNumber(ratio, 2)}x`;
}

async function main() {
  const args = process.argv.slice(2);
  
  let label1: string;
  let label2: string;
  let file1Position: string;
  let file2Position: string;
  let file1Daily: string;
  let file2Daily: string;
  let file1TransactionDetails: string;
  let file2TransactionDetails: string;
  let outputPath: string;
  let targetwalletAddr: string = "";
  let blockRange: string = "";
  
  if (args.length === 0) {
    // Default mode: End-to-end processing and comparison of copywallet vs targetwallet
    console.log("=".repeat(80));
    console.log("COPYWALLET VS TARGETWALLET COMPARISON");
    console.log("=".repeat(80));
    console.log("\nThis will process both wallets and generate a comparison report.\n");
    
    // Auto-detect addresses from folder names
    const copywalletInputDir = path.join(__dirname, "..", "input", "copywallet-comparison", "copywallet");
    const targetwalletInputDir = path.join(__dirname, "..", "input", "copywallet-comparison", "targetwallet");
    
    // Find address folders
    const copywalletDirs = fs.readdirSync(copywalletInputDir).filter(f => {
      const fullPath = path.join(copywalletInputDir, f);
      return fs.statSync(fullPath).isDirectory() && f.startsWith("0x");
    });
    
    const targetwalletDirs = fs.readdirSync(targetwalletInputDir).filter(f => {
      const fullPath = path.join(targetwalletInputDir, f);
      return fs.statSync(fullPath).isDirectory() && f.startsWith("0x");
    });
    
    if (copywalletDirs.length === 0) {
      console.error("Error: No address folder found in input/copywallet-comparison/copywallet/");
      console.error("Please create a folder with the copywallet address (e.g., 0xa8a5...) containing the CSV files.");
      process.exit(1);
    }
    
    if (targetwalletDirs.length === 0) {
      console.error("Error: No address folder found in input/copywallet-comparison/targetwallet/");
      console.error("Please create a folder with the targetwallet address (e.g., 0x71d8...) containing the CSV files.");
      process.exit(1);
    }
    
    if (copywalletDirs.length > 1) {
      console.error("Error: Multiple address folders found in input/copywallet-comparison/copywallet/");
      console.error("Please keep only one address folder.");
      process.exit(1);
    }
    
    if (targetwalletDirs.length > 1) {
      console.error("Error: Multiple address folders found in input/copywallet-comparison/targetwallet/");
      console.error("Please keep only one address folder.");
      process.exit(1);
    }
    
    try {
      // Step 1: Process copywallet
      console.log("\n" + "=".repeat(80));
      console.log("[1/5] Processing copywallet data...");
      console.log("=".repeat(80));
      execSync("tsx src/index.ts copywallet", { stdio: "inherit", cwd: path.join(__dirname, "..") });
      
      // Step 2: Analyze copywallet
      console.log("\n" + "=".repeat(80));
      console.log("[2/5] Analyzing copywallet...");
      console.log("=".repeat(80));
      execSync("tsx src/analyze.ts copywallet", { stdio: "inherit", cwd: path.join(__dirname, "..") });
      
      // Step 3: Process targetwallet
      console.log("\n" + "=".repeat(80));
      console.log("[3/5] Processing targetwallet data...");
      console.log("=".repeat(80));
      execSync("tsx src/index.ts targetwallet", { stdio: "inherit", cwd: path.join(__dirname, "..") });
      
      // Step 4: Analyze targetwallet
      console.log("\n" + "=".repeat(80));
      console.log("[4/5] Analyzing targetwallet...");
      console.log("=".repeat(80));
      execSync("tsx src/analyze.ts targetwallet", { stdio: "inherit", cwd: path.join(__dirname, "..") });
      
      // Step 5: Generate comparison
      console.log("\n" + "=".repeat(80));
      console.log("[5/5] Generating comparison report...");
      console.log("=".repeat(80));
      
    } catch (error: any) {
      console.error("\nError during processing:", error.message);
      process.exit(1);
    }
    
    console.log("Comparing copywallet vs targetwallet...");
    
    // Read addresses from folder names (already detected above)
    const copywalletAddr = copywalletDirs[0];
    targetwalletAddr = targetwalletDirs[0];
    
    // Extract block range for subdirectory
    const inputDir = path.join(__dirname, "..", "input", "copywallet-comparison", "targetwallet", targetwalletAddr);
    const inputFiles = fs.readdirSync(inputDir);
    const actionsFile = inputFiles.find(f => f.startsWith("actions_") && f.endsWith(".csv"));
    
    blockRange = "unknown";
    
    // Extract block range from filename (e.g., "actions_blocks_38010776_38014926.csv")
    if (actionsFile) {
      const match = actionsFile.match(/blocks_(\d+)_(\d+)/);
      if (match) {
        blockRange = `${match[1]}_${match[2]}`;
      }
    }
    
    // Create subdirectory: {targetAddress}_{blockRange}/
    const sessionDir = `${targetwalletAddr}_${blockRange}`;
    const baseOutputDir = path.join(__dirname, "..", "output", "copywallet-comparison");
    const outputDir = path.join(baseOutputDir, sessionDir);
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const copywalletDir = path.join(outputDir, "copywallet");
    const targetwalletDir = path.join(outputDir, "targetwallet");
    
    // Find analysis files for copywallet
    if (!fs.existsSync(copywalletDir)) {
      console.error(`Error: ${copywalletDir} not found`);
      console.error(`Please run 'npm start copywallet' and 'npm run analyze copywallet' first.`);
      process.exit(1);
    }
    
    if (!fs.existsSync(targetwalletDir)) {
      console.error(`Error: ${targetwalletDir} not found`);
      console.error(`Please run 'npm start targetwallet' and 'npm run analyze targetwallet' first.`);
      process.exit(1);
    }
    
    const copywalletFiles = fs.readdirSync(copywalletDir);
    const targetwalletFiles = fs.readdirSync(targetwalletDir);
    
    const copywalletPositionFile = copywalletFiles.find(f => f.startsWith("analysis_by_position_") && f.endsWith(".csv"));
    const targetwalletPositionFile = targetwalletFiles.find(f => f.startsWith("analysis_by_position_") && f.endsWith(".csv"));
    
    if (!copywalletPositionFile || !targetwalletPositionFile) {
      console.error("Error: Missing analysis files");
      if (!copywalletPositionFile) console.error("  - Missing copywallet analysis_by_position_*.csv");
      if (!targetwalletPositionFile) console.error("  - Missing targetwallet analysis_by_position_*.csv");
      console.error(`Please run 'npm run analyze copywallet' and 'npm run analyze targetwallet' first.`);
      process.exit(1);
    }
    
    // Extract file labels from filenames for locating files
    const copywalletLabel = copywalletPositionFile.replace("analysis_by_position_", "").replace(".csv", "");
    const targetwalletLabel = targetwalletPositionFile.replace("analysis_by_position_", "").replace(".csv", "");
    
    file1Position = path.join(copywalletDir, copywalletPositionFile);
    file2Position = path.join(targetwalletDir, targetwalletPositionFile);
    file1Daily = path.join(copywalletDir, `analysis_by_day_${copywalletLabel}.csv`);
    file2Daily = path.join(targetwalletDir, `analysis_by_day_${targetwalletLabel}.csv`);
    file1TransactionDetails = path.join(copywalletDir, `transaction_details_${copywalletLabel}.csv`);
    file2TransactionDetails = path.join(targetwalletDir, `transaction_details_${targetwalletLabel}.csv`);
    
    // Truncate addresses to 0x + 4 chars for display (e.g., 0xa8a5)
    const truncateAddress = (addr: string): string => {
      if (addr.startsWith("0x") && addr.length > 6) {
        return addr.substring(0, 6); // "0x" + 4 chars
      }
      return addr;
    };
    
    // Set column labels using truncated addresses
    label1 = `${truncateAddress(copywalletAddr)} (copy wallet)`;
    label2 = `${truncateAddress(targetwalletAddr)} (target wallet)`;
    
    outputPath = path.join(outputDir, `copywallet_comparison_${targetwalletAddr}_${blockRange}.csv`);
    
  } else if (args.length === 2) {
    // Legacy mode: custom labels provided
    label1 = args[0];
    label2 = args[1];
    
    const outputDir = path.join(__dirname, "..", "output");
    
    // Prepare output file
    const outputFilename = `comparison_${label1}_${label2}.csv`;
    outputPath = path.join(outputDir, outputFilename);
    
    // Read analysis files
    file1Position = path.join(outputDir, `analysis_by_position_${label1}.csv`);
    file2Position = path.join(outputDir, `analysis_by_position_${label2}.csv`);
    file1Daily = path.join(outputDir, `analysis_by_day_${label1}.csv`);
    file2Daily = path.join(outputDir, `analysis_by_day_${label2}.csv`);
    file1TransactionDetails = path.join(outputDir, `transaction_details_${label1}.csv`);
    file2TransactionDetails = path.join(outputDir, `transaction_details_${label2}.csv`);
  } else {
    console.error("Usage:");
    console.error("  npm run comparison                  # Compare copywallet vs targetwallet (default)");
    console.error("  npm run comparison <label1> <label2> # Compare custom labels");
    console.error("Example: npm run comparison 0xa8a5_11-10 0x71d8_11-10");
    process.exit(1);
  }
  
  // CSV data array
  const csvData: any[] = [];
  
  if (!fs.existsSync(file1Position) || !fs.existsSync(file2Position)) {
    console.error("Error: Analysis files not found");
    console.error(`  Looking for: ${file1Position}`);
    console.error(`  Looking for: ${file2Position}`);
    process.exit(1);
  }
  
  // Parse position analysis
  const data1Position: AnalysisRow[] = parse(fs.readFileSync(file1Position, "utf-8"), {
    columns: true,
    skip_empty_lines: true
  });
  
  const data2Position: AnalysisRow[] = parse(fs.readFileSync(file2Position, "utf-8"), {
    columns: true,
    skip_empty_lines: true
  });
  
  // Parse daily analysis
  const data1Daily: DailyRow[] = parse(fs.readFileSync(file1Daily, "utf-8"), {
    columns: true,
    skip_empty_lines: true
  });
  
  const data2Daily: DailyRow[] = parse(fs.readFileSync(file2Daily, "utf-8"), {
    columns: true,
    skip_empty_lines: true
  });
  
  // Get wallet summary rows
  const wallet1 = data1Position.find(r => r.row_type === "wallet_summary");
  const wallet2 = data2Position.find(r => r.row_type === "wallet_summary");
  
  if (!wallet1 || !wallet2) {
    console.error("Error: Could not find wallet_summary rows");
    process.exit(1);
  }
  
  // Get daily TOTAL data (last row)
  const daily1 = data1Daily[data1Daily.length - 1];
  const daily2 = data2Daily[data2Daily.length - 1];
  
  // Calculate excluded positions by reading transaction details
  const calculateExcludedPositions = (transactionFile: string): { 
    excluded: number, 
    total: number,
    preExisting: number,
    unclosed: number
  } => {
    if (!fs.existsSync(transactionFile)) {
      return { excluded: 0, total: 0, preExisting: 0, unclosed: 0 };
    }
    
    const txData: any[] = parse(fs.readFileSync(transactionFile, "utf-8"), {
      columns: true,
      skip_empty_lines: true
    });
    
    // Group by token_id to determine position status
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
    
    let completeCount = 0;
    let preExistingCount = 0;  // burn only (opened before observation)
    let unclosedCount = 0;      // mint only (still open)
    
    for (const [_, status] of positionMap) {
      if (status.hasMint && status.hasBurn) {
        completeCount++;
      } else if (status.hasBurn && !status.hasMint) {
        preExistingCount++;
      } else if (status.hasMint && !status.hasBurn) {
        unclosedCount++;
      }
    }
    
    return { 
      excluded: preExistingCount + unclosedCount, 
      total: completeCount + preExistingCount + unclosedCount,
      preExisting: preExistingCount,
      unclosed: unclosedCount
    };
  };
  
  const excluded1Data = calculateExcludedPositions(file1TransactionDetails);
  const excluded2Data = calculateExcludedPositions(file2TransactionDetails);
  
  // Extract metadata from transaction details (block range and timestamps)
  const extractMetadata = (transactionFile: string): { 
    blockRange: string, 
    startTime: string, 
    endTime: string 
  } => {
    if (!fs.existsSync(transactionFile)) {
      return { blockRange: "unknown", startTime: "unknown", endTime: "unknown" };
    }
    
    const txData: any[] = parse(fs.readFileSync(transactionFile, "utf-8"), {
      columns: true,
      skip_empty_lines: true
    });
    
    if (txData.length === 0) {
      return { blockRange: "unknown", startTime: "unknown", endTime: "unknown" };
    }
    
    // Get first and last transaction timestamps and blocks
    const sortedByTime = [...txData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    const firstTx = sortedByTime[0];
    const lastTx = sortedByTime[sortedByTime.length - 1];
    
    // Extract blocks
    const blocks = txData.map(row => parseInt(row.block)).filter(b => !isNaN(b));
    
    if (blocks.length === 0) {
      return {
        blockRange: "unknown",
        startTime: firstTx.timestamp || "unknown",
        endTime: lastTx.timestamp || "unknown"
      };
    }
    
    const minBlock = Math.min(...blocks);
    const maxBlock = Math.max(...blocks);
    
    return {
      blockRange: `${minBlock} to ${maxBlock}`,
      startTime: firstTx.timestamp,
      endTime: lastTx.timestamp
    };
  };
  
  const metadata = extractMetadata(file1TransactionDetails); // Use copywallet metadata
  
  // Calculate metrics
  const positions1 = parseInt(wallet1.positions_count);
  const positions2 = parseInt(wallet2.positions_count);
  const events1 = parseInt(wallet1.events_count);
  const events2 = parseInt(wallet2.events_count);
  const avgTime1 = parseFloat(wallet1.active_time_seconds);
  const avgTime2 = parseFloat(wallet2.active_time_seconds);
  
  const excluded1 = excluded1Data.excluded;
  const excluded2 = excluded2Data.excluded;
  const preExisting1 = excluded1Data.preExisting;
  const preExisting2 = excluded2Data.preExisting;
  const unclosed1 = excluded1Data.unclosed;
  const unclosed2 = excluded2Data.unclosed;
  
  // Calculate APR (need to derive from data)
  const depositValue1 = parseFloat(wallet1.deposit_value_usd);
  const depositValue2 = parseFloat(wallet2.deposit_value_usd);
  const withdrawValue1 = parseFloat(wallet1.withdrawal_value_usd);
  const withdrawValue2 = parseFloat(wallet2.withdrawal_value_usd);
  const avgCapital1 = (depositValue1 + withdrawValue1) / 2;
  const avgCapital2 = (depositValue2 + withdrawValue2) / 2;
  
  const profit1 = parseFloat(wallet1.profit_usd);
  const profit2 = parseFloat(wallet2.profit_usd);
  
  // Calculate operating time from daily stats
  const positionsOpened1 = parseInt(daily1.positions_opened);
  const positionsOpened2 = parseInt(daily2.positions_opened);
  const positionsClosed1 = parseInt(daily1.positions_closed);
  const positionsClosed2 = parseInt(daily2.positions_closed);
  
  const depositUsdc1 = parseFloat(wallet1.total_deposit_usdc);
  const depositUsdc2 = parseFloat(wallet2.total_deposit_usdc);
  const depositCbbtc1 = parseFloat(wallet1.total_deposit_cbbtc);
  const depositCbbtc2 = parseFloat(wallet2.total_deposit_cbbtc);
  
  const withdrawUsdc1 = parseFloat(wallet1.total_withdraw_usdc);
  const withdrawUsdc2 = parseFloat(wallet2.total_withdraw_usdc);
  const withdrawCbbtc1 = parseFloat(wallet1.total_withdraw_cbbtc);
  const withdrawCbbtc2 = parseFloat(wallet2.total_withdraw_cbbtc);
  
  const netUsdc1 = parseFloat(wallet1.net_usdc_change);
  const netUsdc2 = parseFloat(wallet2.net_usdc_change);
  const netCbbtc1 = parseFloat(wallet1.net_cbbtc_change);
  const netCbbtc2 = parseFloat(wallet2.net_cbbtc_change);
  
  const aeroRewards1 = parseFloat(daily1.aero_rewards_collected);
  const aeroRewards2 = parseFloat(daily2.aero_rewards_collected);
  
  const fees1 = parseFloat(wallet1.total_fees_usd);
  const fees2 = parseFloat(wallet2.total_fees_usd);
  
  const il1 = parseFloat(wallet1.impermanent_loss_usd);
  const il2 = parseFloat(wallet2.impermanent_loss_usd);
  
  // AERO per $1M capital
  const aeroPerMillion1 = (aeroRewards1 / avgCapital1) * 1_000_000;
  const aeroPerMillion2 = (aeroRewards2 / avgCapital2) * 1_000_000;
  
  
  // Calculate operating time from actual transaction data for each wallet
  const metadata1 = extractMetadata(file1TransactionDetails);
  const metadata2 = extractMetadata(file2TransactionDetails);
  
  const operatingSeconds1 = (new Date(metadata1.endTime).getTime() - new Date(metadata1.startTime).getTime()) / 1000;
  const operatingSeconds2 = (new Date(metadata2.endTime).getTime() - new Date(metadata2.startTime).getTime()) / 1000;
  const operatingDays1 = operatingSeconds1 / (24 * 60 * 60);
  const operatingDays2 = operatingSeconds2 / (24 * 60 * 60);
  
  // Calculate capital ratio (baseline for scalable metrics)
  console.log("\n=== DEBUG: Capital Ratio Calculation ===");
  console.log(`depositValue1: ${depositValue1}`);
  console.log(`withdrawValue1: ${withdrawValue1}`);
  console.log(`avgCapital1: ${avgCapital1}`);
  console.log(`depositValue2: ${depositValue2}`);
  console.log(`withdrawValue2: ${withdrawValue2}`);
  console.log(`avgCapital2: ${avgCapital2}`);
  const capitalRatio = avgCapital1 / avgCapital2;
  console.log(`capitalRatio: ${capitalRatio}`);
  console.log("=====================================\n");
  
  // Helper function to calculate ratio vs expected
  const calculateVsExpected = (actualRatio: string, expectedRatio: number): string => {
    if (actualRatio === "-" || actualRatio === "N/A" || actualRatio === "Same") return "-";
    
    // Extract numeric value from ratio string (e.g., "0.0012x" -> 0.0012)
    const numericRatio = parseFloat(actualRatio.replace('x', ''));
    if (isNaN(numericRatio)) return "-";
    
    const ratioVsExpected = numericRatio / expectedRatio;
    
    // Format with appropriate precision
    if (ratioVsExpected >= 10) return `${ratioVsExpected.toFixed(1)}x`;
    if (ratioVsExpected >= 1) return `${ratioVsExpected.toFixed(2)}x`;
    if (ratioVsExpected >= 0.01) return `${ratioVsExpected.toFixed(2)}x`;
    // For very small ratios, use 6 decimal places
    if (ratioVsExpected < 0.01 && ratioVsExpected > 0) return `${ratioVsExpected.toFixed(6)}x`;
    return `${ratioVsExpected.toFixed(4)}x`;
  };
  
  // Build CSV data
  // Add metadata section
  csvData.push({
    metric: "ANALYSIS METADATA",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  csvData.push({
    metric: "Block Range",
    [label1]: metadata.blockRange,
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  csvData.push({
    metric: "Start Time",
    [label1]: metadata.startTime,
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  csvData.push({
    metric: "End Time",
    [label1]: metadata.endTime,
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  csvData.push({
    metric: "",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  
  // Baseline & Positions
  csvData.push({
    metric: "BASELINE",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  csvData.push({
    metric: "Capital Ratio (baseline for scalable metrics)",
    [label1]: "1.00x",
    [label2]: (1 / capitalRatio).toFixed(2) + "x",
    ratio: capitalRatio.toFixed(4) + "x",
    vs_expected: "1.00x"
  });
  
  csvData.push({
    metric: "POSITIONS & ACTIVITY",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  const posRatio = calculateRatio(positions1, positions2);
  csvData.push({
    metric: "Complete Positions",
    [label1]: positions1,
    [label2]: positions2,
    ratio: posRatio,
    vs_expected: calculateVsExpected(posRatio, 1.0) // Should be ~1.0x (efficiency)
  });
  csvData.push({
    metric: "Excluded - Pre-existing (burn only)",
    [label1]: preExisting1,
    [label2]: preExisting2,
    ratio: "-",
    vs_expected: "-"
  });
  csvData.push({
    metric: "Excluded - Unclosed (mint only)",
    [label1]: unclosed1,
    [label2]: unclosed2,
    ratio: "-",
    vs_expected: "-"
  });
  const eventsRatio = calculateRatio(events1, events2);
  csvData.push({
    metric: "Total Events (Complete)",
    [label1]: events1,
    [label2]: events2,
    ratio: eventsRatio,
    vs_expected: calculateVsExpected(eventsRatio, 1.0) // Should be ~1.0x (efficiency)
  });
  const operatingTimeRatio = operatingSeconds1 === operatingSeconds2 ? "Same" : calculateRatio(operatingSeconds1, operatingSeconds2);
  csvData.push({
    metric: "Operating Time (last tx - first tx)",
    [label1]: formatDuration(operatingDays1),
    [label2]: formatDuration(operatingDays2),
    ratio: operatingTimeRatio,
    vs_expected: "-"
  });
  const durationRatio = calculateRatio(avgTime1, avgTime2);
  csvData.push({
    metric: "Avg Position Duration (seconds)",
    [label1]: avgTime1.toFixed(1),
    [label2]: avgTime2.toFixed(1),
    ratio: durationRatio,
    vs_expected: calculateVsExpected(durationRatio, 1.0) // Should be ~1.0x (efficiency)
  });
  
  // Add per-position metrics
  const eventsPerPos1 = events1 / positions1;
  const eventsPerPos2 = events2 / positions2;
  const eventsPerPosRatio = calculateRatio(eventsPerPos1, eventsPerPos2);
  csvData.push({
    metric: "Events per Position",
    [label1]: eventsPerPos1.toFixed(2),
    [label2]: eventsPerPos2.toFixed(2),
    ratio: eventsPerPosRatio,
    vs_expected: calculateVsExpected(eventsPerPosRatio, 1.0) // Should be ~1.0x (efficiency)
  });
  
  const posPerHour1 = positions1 / (operatingDays1 * 24);
  const posPerHour2 = positions2 / (operatingDays2 * 24);
  const posPerHourRatio = calculateRatio(posPerHour1, posPerHour2);
  csvData.push({
    metric: "Positions per Hour",
    [label1]: posPerHour1.toFixed(2),
    [label2]: posPerHour2.toFixed(2),
    ratio: posPerHourRatio,
    vs_expected: calculateVsExpected(posPerHourRatio, 1.0) // Should be ~1.0x (efficiency)
  });
  
  // Capital Deployed
  csvData.push({
    metric: "CAPITAL DEPLOYED",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  const depositRatio = calculateRatio(depositValue1, depositValue2);
  csvData.push({
    metric: "Total Deposits (USD)",
    [label1]: depositValue1.toFixed(2),
    [label2]: depositValue2.toFixed(2),
    ratio: depositRatio,
    vs_expected: calculateVsExpected(depositRatio, capitalRatio) // Should match capital ratio
  });
  const usdcDepRatio = calculateRatio(depositUsdc1, depositUsdc2);
  csvData.push({
    metric: "USDC Deposited",
    [label1]: depositUsdc1.toFixed(2),
    [label2]: depositUsdc2.toFixed(2),
    ratio: usdcDepRatio,
    vs_expected: calculateVsExpected(usdcDepRatio, capitalRatio) // Should match capital ratio
  });
  const btcDepRatio = calculateRatio(depositCbbtc1, depositCbbtc2);
  csvData.push({
    metric: "cbBTC Deposited",
    [label1]: depositCbbtc1.toFixed(6),
    [label2]: depositCbbtc2.toFixed(6),
    ratio: btcDepRatio,
    vs_expected: calculateVsExpected(btcDepRatio, capitalRatio) // Should match capital ratio
  });
  const avgCapRatio = calculateRatio(avgCapital1, avgCapital2);
  csvData.push({
    metric: "Avg Capital Deployed (USD)",
    [label1]: avgCapital1.toFixed(2),
    [label2]: avgCapital2.toFixed(2),
    ratio: avgCapRatio,
    vs_expected: calculateVsExpected(avgCapRatio, capitalRatio) // Should match capital ratio
  });
  
  // Token allocation ratios
  const usdcBtcRatio1 = depositUsdc1 / depositCbbtc1;
  const usdcBtcRatio2 = depositUsdc2 / depositCbbtc2;
  const tokenAllocRatio = calculateRatio(usdcBtcRatio1, usdcBtcRatio2);
  csvData.push({
    metric: "USDC/cbBTC Deposit Ratio",
    [label1]: usdcBtcRatio1.toFixed(2),
    [label2]: usdcBtcRatio2.toFixed(2),
    ratio: tokenAllocRatio,
    vs_expected: calculateVsExpected(tokenAllocRatio, 1.0) // Should be ~1.0x (same strategy)
  });
  
  // Per-position deposit metrics
  const avgDepositPerPos1 = depositValue1 / positions1;
  const avgDepositPerPos2 = depositValue2 / positions2;
  const avgDepPosRatio = calculateRatio(avgDepositPerPos1, avgDepositPerPos2);
  csvData.push({
    metric: "Avg Deposit per Position (USD)",
    [label1]: avgDepositPerPos1.toFixed(2),
    [label2]: avgDepositPerPos2.toFixed(2),
    ratio: avgDepPosRatio,
    vs_expected: calculateVsExpected(avgDepPosRatio, capitalRatio) // Should match capital ratio
  });
  
  // Withdrawals
  csvData.push({
    metric: "WITHDRAWALS",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  const withdrawRatio = calculateRatio(withdrawValue1, withdrawValue2);
  csvData.push({
    metric: "Total Withdrawals (USD)",
    [label1]: withdrawValue1.toFixed(2),
    [label2]: withdrawValue2.toFixed(2),
    ratio: withdrawRatio,
    vs_expected: calculateVsExpected(withdrawRatio, capitalRatio)
  });
  const usdcWithRatio = calculateRatio(withdrawUsdc1, withdrawUsdc2);
  csvData.push({
    metric: "USDC Withdrawn",
    [label1]: withdrawUsdc1.toFixed(2),
    [label2]: withdrawUsdc2.toFixed(2),
    ratio: usdcWithRatio,
    vs_expected: calculateVsExpected(usdcWithRatio, capitalRatio)
  });
  const btcWithRatio = calculateRatio(withdrawCbbtc1, withdrawCbbtc2);
  csvData.push({
    metric: "cbBTC Withdrawn",
    [label1]: withdrawCbbtc1.toFixed(6),
    [label2]: withdrawCbbtc2.toFixed(6),
    ratio: btcWithRatio,
    vs_expected: calculateVsExpected(btcWithRatio, capitalRatio)
  });
  
  // Net Changes
  csvData.push({
    metric: "NET CHANGES",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  const netUsdcRatio = calculateRatio(Math.abs(netUsdc1), Math.abs(netUsdc2));
  csvData.push({
    metric: "Net USDC",
    [label1]: netUsdc1.toFixed(2),
    [label2]: netUsdc2.toFixed(2),
    ratio: netUsdcRatio,
    vs_expected: calculateVsExpected(netUsdcRatio, capitalRatio)
  });
  const netBtcRatio = calculateRatio(Math.abs(netCbbtc1), Math.abs(netCbbtc2));
  csvData.push({
    metric: "Net cbBTC",
    [label1]: netCbbtc1.toFixed(6),
    [label2]: netCbbtc2.toFixed(6),
    ratio: netBtcRatio,
    vs_expected: calculateVsExpected(netBtcRatio, capitalRatio)
  });
  
  // Rewards & Fees
  csvData.push({
    metric: "REWARDS & FEES",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  csvData.push({
    metric: "Trading Fees (USD)",
    [label1]: fees1.toFixed(2),
    [label2]: fees2.toFixed(2),
    ratio: "-",
    vs_expected: "-"
  });
  const aeroRatio = calculateRatio(aeroRewards1, aeroRewards2);
  csvData.push({
    metric: "AERO Value (USD)",
    [label1]: aeroRewards1.toFixed(2),
    [label2]: aeroRewards2.toFixed(2),
    ratio: aeroRatio,
    vs_expected: calculateVsExpected(aeroRatio, capitalRatio)
  });
  const aeroPerMilRatio = calculateRatio(aeroPerMillion1, aeroPerMillion2);
  csvData.push({
    metric: "AERO per $1M Capital (USD)",
    [label1]: aeroPerMillion1.toFixed(2),
    [label2]: aeroPerMillion2.toFixed(2),
    ratio: aeroPerMilRatio,
    vs_expected: calculateVsExpected(aeroPerMilRatio, 1.0)
  });
  
  // Per-position AERO metrics
  const aeroPerPos1 = aeroRewards1 / positions1;
  const aeroPerPos2 = aeroRewards2 / positions2;
  const aeroPosRatio = calculateRatio(aeroPerPos1, aeroPerPos2);
  csvData.push({
    metric: "AERO per Position (USD)",
    [label1]: aeroPerPos1.toFixed(4),
    [label2]: aeroPerPos2.toFixed(4),
    ratio: aeroPosRatio,
    vs_expected: calculateVsExpected(aeroPosRatio, capitalRatio)
  });
  
  // Impermanent Loss
  csvData.push({
    metric: "IMPERMANENT LOSS",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  const ilRatio = calculateRatio(Math.abs(il1), Math.abs(il2));
  csvData.push({
    metric: "IL (USD)",
    [label1]: il1.toFixed(2),
    [label2]: il2.toFixed(2),
    ratio: ilRatio,
    vs_expected: calculateVsExpected(ilRatio, capitalRatio)
  });
  const ilPct1 = (il1 / avgCapital1) * 100;
  const ilPct2 = (il2 / avgCapital2) * 100;
  const ilPctRatio = calculateRatio(Math.abs(ilPct1), Math.abs(ilPct2));
  csvData.push({
    metric: "IL as % of Capital",
    [label1]: ilPct1.toFixed(6),
    [label2]: ilPct2.toFixed(6),
    ratio: ilPctRatio,
    vs_expected: calculateVsExpected(ilPctRatio, 1.0)
  });
  
  // Profitability
  csvData.push({
    metric: "PROFITABILITY",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  const profitRatio = calculateRatio(Math.abs(profit1), Math.abs(profit2));
  csvData.push({
    metric: "Total Profit/Loss (USD)",
    [label1]: profit1.toFixed(2),
    [label2]: profit2.toFixed(2),
    ratio: profitRatio,
    vs_expected: calculateVsExpected(profitRatio, capitalRatio)
  });
  const profitPct1 = (profit1 / avgCapital1) * 100;
  const profitPct2 = (profit2 / avgCapital2) * 100;
  const profitPctRatio = calculateRatio(Math.abs(profitPct1), Math.abs(profitPct2));
  csvData.push({
    metric: "Profit % of Capital",
    [label1]: profitPct1.toFixed(6),
    [label2]: profitPct2.toFixed(6),
    ratio: profitPctRatio,
    vs_expected: calculateVsExpected(profitPctRatio, 1.0)
  });
  
  // Calculate APR
  const avgDepositPerPosition1 = positions1 > 0 ? depositValue1 / positions1 : 0;
  const avgDepositPerPosition2 = positions2 > 0 ? depositValue2 / positions2 : 0;
  const apr1 = avgDepositPerPosition1 > 0 ? (profit1 / avgDepositPerPosition1) * (365 / operatingDays1) * 100 : 0;
  const apr2 = avgDepositPerPosition2 > 0 ? (profit2 / avgDepositPerPosition2) * (365 / operatingDays2) * 100 : 0;
  
  // Annualized Returns
  csvData.push({
    metric: "ANNUALIZED RETURNS",
    [label1]: "",
    [label2]: "",
    ratio: "",
    vs_expected: ""
  });
  const aprRatio = calculateRatio(Math.abs(apr1), Math.abs(apr2));
  csvData.push({
    metric: "APR (%)",
    [label1]: apr1.toFixed(2),
    [label2]: apr2.toFixed(2),
    ratio: aprRatio,
    vs_expected: calculateVsExpected(aprRatio, 1.0)
  });
  
  const xirr1 = wallet1.xirr ? parseFloat(wallet1.xirr).toFixed(2) : "N/A";
  const xirr2 = wallet2.xirr ? parseFloat(wallet2.xirr).toFixed(2) : "N/A";
  csvData.push({
    metric: "Portfolio XIRR (%)",
    [label1]: xirr1,
    [label2]: xirr2,
    ratio: "-",
    vs_expected: "-"
  });
  
  // Write to CSV file
  const csvOutput = stringify(csvData, {
    header: true,
    columns: [
      { key: 'metric', header: 'Metric' },
      { key: label1, header: label1 },
      { key: label2, header: label2 },
      { key: 'ratio', header: `Ratio (${label1}/${label2})` },
      { key: 'vs_expected', header: 'vs Expected (Ratio/Expected)' }
    ]
  });
  
  fs.writeFileSync(outputPath, csvOutput, "utf-8");
  
  console.log(`\nComparison saved to: ${outputPath}`);
  console.log(`Total metrics compared: ${csvData.length}`);
  
  // If running in end-to-end mode, show completion message
  if (args.length === 0) {
    console.log("\n" + "=".repeat(80));
    console.log("COMPARISON COMPLETE!");
    console.log("=".repeat(80));
    console.log(`\nCheck output/copywallet-comparison/${targetwalletAddr}_${blockRange}/ for results:`);
    console.log("  - copywallet/ - Your copy bot analysis");
    console.log("  - targetwallet/ - Target wallet analysis");
    console.log(`  - copywallet_comparison_${targetwalletAddr}_${blockRange}.csv - Side-by-side comparison`);
    console.log();
  }
}

main().catch(error => {
  console.error("Error:", error.message);
  process.exit(1);
});

