import "dotenv/config";
import { JsonRpcProvider, keccak256, toUtf8Bytes, Log } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import axios from "axios";

// Configuration
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const POOL_ADDRESS = "0x4e962BB3889Bf030368F56810A9c96B83CB3E778"; // USDC-cbBTC pool
const TOKEN0_DECIMALS = 6; // USDC
const TOKEN1_DECIMALS = 8; // cbBTC
const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

// Swap event signature for Uniswap V3 (Aerodrome uses V3 style)
const SWAP_V3_SIG = "Swap(address,address,int256,int256,uint160,uint128,int24)";
const SWAP_TOPIC = keccak256(toUtf8Bytes(SWAP_V3_SIG));

const Q96 = 2n ** 96n;

const provider = new JsonRpcProvider(RPC_URL);

// Types
interface ActionRow {
  timestamp: string;
  block_number: number;
  tx_index: number;
  tx_hash: string;
  action: string;
  log_index: number;
  token_id: string;
  tick_lower: string;
  tick_upper: string;
  liquidity: string;
  amount0: string;
  amount1: string;
  amount0_dec: number;
  amount1_dec: number;
  fee0: string;
  fee1: string;
  fee0_dec: number;
  fee1_dec: number;
  details: string;
}

interface EarningsRow {
  timestamp: string;
  action: string;
  token_id: string;
  reward: number;
  inpos0: number;
  inpos1: number;
  [key: string]: any;
}

interface SwapEvent {
  blockNumber: number;
  transactionHash: string;
  index: number;
  sqrtPriceX96: bigint;
}

interface OutputRow {
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
  AERO_price: number;
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

// Helper functions
function parseSqrtPriceX96FromSwapData(hexData: string): bigint {
  // Swap event data packs: amount0, amount1, sqrtPriceX96, liquidity, tick
  // sqrtPriceX96 is the 3rd slot (0-indexed: 2)
  const clean = hexData.startsWith("0x") ? hexData.slice(2) : hexData;
  const SLOT_BYTES = 64;
  const slot2 = clean.slice(2 * SLOT_BYTES, 3 * SLOT_BYTES);
  return BigInt("0x" + slot2);
}

function priceToken1PerToken0FromSqrtPriceX96(sqrtPriceX96: bigint): number {
  // Price = (sqrtP / 2^96)^2
  const num = Number(sqrtPriceX96) / Number(Q96);
  return num * num;
}

function adjustForDecimals(rawPrice: number, dec0: number, dec1: number): number {
  return rawPrice * Math.pow(10, dec0 - dec1);
}

function calculateCbBtcPrice(sqrtPriceX96: bigint): number {
  // Get raw price (token1 per token0)
  const rawRatio = priceToken1PerToken0FromSqrtPriceX96(sqrtPriceX96);
  // Adjust for decimals to get actual token1 per token0
  const token1PerToken0 = adjustForDecimals(rawRatio, TOKEN0_DECIMALS, TOKEN1_DECIMALS);
  // cbBTC price in USDC is the inverse (USDC per cbBTC)
  return 1 / token1PerToken0;
}

function toExcelTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSwapLogsInRange(fromBlock: number, toBlock: number, retries = 5): Promise<Log[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const logs = await provider.getLogs({
        address: POOL_ADDRESS,
        fromBlock,
        toBlock,
        topics: [SWAP_TOPIC],
      });
      return logs;
    } catch (error: any) {
      const isRateLimit = error?.message?.includes("rate limit") || 
                          error?.code === -32016 ||
                          error?.error?.code === -32016;
      
      if (isRateLimit && attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        console.log(`    ⏳ Rate limit hit, waiting ${delay}ms before retry ${attempt + 1}/${retries - 1}...`);
        await sleep(delay);
        continue;
      }
      
      throw error;
    }
  }
  
  throw new Error("Max retries exceeded");
}

// Fetch all swaps in a block range and cache them
async function fetchAllSwapsInRange(fromBlock: number, toBlock: number): Promise<SwapEvent[]> {
  console.log(`\nFetching all swap events from block ${fromBlock} to ${toBlock}...`);
  
  const swaps: SwapEvent[] = [];
  const CHUNK_SIZE = 10000; // Adjust based on your RPC limits
  
  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, toBlock);
    console.log(`  Fetching blocks ${start} to ${end}...`);
    
    const logs = await getSwapLogsInRange(start, end);
    
    for (const log of logs) {
      const sqrtPriceX96 = parseSqrtPriceX96FromSwapData(log.data);
      swaps.push({
        blockNumber: Number(log.blockNumber),
        transactionHash: log.transactionHash,
        index: Number(log.index),
        sqrtPriceX96,
      });
    }
    
    // Small delay between chunks to be respectful to RPC
    if (end < toBlock) {
      await sleep(200);
    }
  }
  
  // Sort by block number and index for efficient searching
  swaps.sort((a, b) => {
    const blockDiff = a.blockNumber - b.blockNumber;
    if (blockDiff !== 0) return blockDiff;
    return a.index - b.index;
  });
  
  console.log(`✓ Fetched and cached ${swaps.length} swap events\n`);
  return swaps;
}

// Find closest swap before using cached swaps (much faster!)
function findClosestSwapBeforeFromCache(swaps: SwapEvent[], block: number, logIndex: number): SwapEvent | null {
  let result: SwapEvent | null = null;
  
  // Iterate through sorted swaps to find the closest one before our target
  for (const swap of swaps) {
    if (swap.blockNumber < block || (swap.blockNumber === block && swap.index < logIndex)) {
      result = swap; // Keep updating with later swaps
    } else {
      break; // We've gone past our target, no need to continue
    }
  }
  
  return result;
}

// Find closest swap after using cached swaps (much faster!)
function findClosestSwapAfterFromCache(swaps: SwapEvent[], block: number, logIndex: number): SwapEvent | null {
  // Iterate through sorted swaps to find the first one after our target
  for (const swap of swaps) {
    if (swap.blockNumber > block || (swap.blockNumber === block && swap.index > logIndex)) {
      return swap; // Return first match
    }
  }
  
  return null;
}

// Fetch AERO price data from CoinGecko API
async function fetchAeroPrices(startTimestamp: string, endTimestamp: string): Promise<Map<number, number>> {
  console.log("\nFetching AERO prices from CoinGecko...");
  
  const startDate = new Date(startTimestamp);
  const endDate = new Date(endTimestamp);
  
  // Add 1 day buffer on each side
  const fromUnix = Math.floor(startDate.getTime() / 1000) - 86400;
  const toUnix = Math.floor(endDate.getTime() / 1000) + 86400;
  
  try {
    // CoinGecko API endpoint for historical market data
    // Using "aerodrome-finance" as the coin ID
    const response = await axios.get(
      `${COINGECKO_API_URL}/coins/aerodrome-finance/market_chart/range`,
      {
        params: {
          vs_currency: "usd",
          from: fromUnix,
          to: toUnix,
        },
      }
    );
    
    // Response format: { prices: [[timestamp_ms, price], ...] }
    const prices = response.data.prices as [number, number][];
    
    // Create a map of timestamp (seconds) -> price
    const priceMap = new Map<number, number>();
    
    for (const [timestampMs, price] of prices) {
      const timestampSec = Math.floor(timestampMs / 1000);
      priceMap.set(timestampSec, price);
    }
    
    console.log(`✓ Fetched ${priceMap.size} AERO price points\n`);
    return priceMap;
  } catch (error: any) {
    console.error("Failed to fetch AERO prices from CoinGecko:", error.message);
    console.log("⚠️  Falling back to 1 AERO = 1 USD\n");
    return new Map<number, number>();
  }
}

// Find closest AERO price for a given timestamp
function getAeroPrice(priceMap: Map<number, number>, timestamp: string): number {
  if (priceMap.size === 0) {
    return 1.0; // Fallback
  }
  
  const targetUnix = Math.floor(new Date(timestamp).getTime() / 1000);
  
  // Find the closest price point
  let closestTime = 0;
  let closestPrice = 1.0;
  let minDiff = Infinity;
  
  for (const [time, price] of priceMap) {
    const diff = Math.abs(time - targetUnix);
    if (diff < minDiff) {
      minDiff = diff;
      closestTime = time;
      closestPrice = price;
    }
  }
  
  return closestPrice;
}

async function main() {
  console.log("LP Returns Analysis - Aerodrome USDC-cbBTC Pool");
  console.log("=".repeat(60));
  
  // Read input files
  const actionsPath = path.join(__dirname, "..", "input", "actions.csv");
  const earningsPath = path.join(__dirname, "..", "input", "earnings_per_action.csv");
  
  if (!fs.existsSync(actionsPath)) {
    console.error(`Error: ${actionsPath} not found`);
    process.exit(1);
  }
  
  if (!fs.existsSync(earningsPath)) {
    console.error(`Error: ${earningsPath} not found`);
    process.exit(1);
  }
  
  console.log("\nReading input files...");
  const actionsContent = fs.readFileSync(actionsPath, "utf-8");
  const earningsContent = fs.readFileSync(earningsPath, "utf-8");
  
  const actions: ActionRow[] = parse(actionsContent, {
    columns: true,
    skip_empty_lines: true,
    cast: (value, context) => {
      if (context.column === "block_number" || context.column === "tx_index" || context.column === "log_index") {
        return parseInt(value);
      }
      if (context.column === "amount0_dec" || context.column === "amount1_dec" || 
          context.column === "fee0_dec" || context.column === "fee1_dec") {
        return parseFloat(value) || 0;
      }
      return value;
    }
  });
  
  const earnings: EarningsRow[] = parse(earningsContent, {
    columns: true,
    skip_empty_lines: true,
    cast: (value, context) => {
      if (context.column === "reward" || context.column === "inpos0" || context.column === "inpos1") {
        return parseFloat(value) || 0;
      }
      return value;
    }
  });
  
  // Create a map of earnings by timestamp + action + token_id for easy lookup
  const earningsMap = new Map<string, number>();
  const earningsFullMap = new Map<string, EarningsRow>();
  
  earnings.forEach((row) => {
    const key = `${row.timestamp}|${row.action}|${row.token_id}`;
    earningsMap.set(key, row.reward);
    earningsFullMap.set(key, row);
  });
  
  // For gauge_getReward without token_id, we need to match based on active position
  // Create a mapping from timestamp to active positions (tracked by inpos amounts)
  const getRewardByTimestamp = new Map<string, EarningsRow>();
  earnings.forEach((row) => {
    if (row.action === "gauge_getReward" && !row.token_id) {
      getRewardByTimestamp.set(row.timestamp, row);
    }
  });
  
  // Build a position tracker: token_id -> recent mint amounts to match against inpos
  const positionAmounts = new Map<string, { amount0: number; amount1: number; timestamp: string }>();
  actions.forEach((action) => {
    if (action.action === "mint" && action.token_id) {
      const existing = positionAmounts.get(action.token_id);
      if (!existing || action.timestamp > existing.timestamp) {
        positionAmounts.set(action.token_id, {
          amount0: action.amount0_dec,
          amount1: action.amount1_dec,
          timestamp: action.timestamp
        });
      }
    }
  });
  
  console.log(`Loaded ${actions.length} actions`);
  console.log(`Loaded ${earnings.length} earnings records`);
  
  // Filter to only the actions we care about (excluding closing_state)
  const relevantActions = ["mint", "burn", "collect", "gauge_getReward"];
  const filteredActions = actions.filter((action) => 
    relevantActions.includes(action.action) && action.action !== "closing_state"
  );
  
  console.log(`Processing ${filteredActions.length} relevant actions...`);
  
  // Determine block range for swap fetching and timestamp range for AERO prices
  let minBlock = Infinity;
  let maxBlock = -Infinity;
  let minTimestamp = filteredActions[0]?.timestamp || "";
  let maxTimestamp = filteredActions[0]?.timestamp || "";
  
  for (const action of filteredActions) {
    if (action.block_number < minBlock) minBlock = action.block_number;
    if (action.block_number > maxBlock) maxBlock = action.block_number;
    if (action.timestamp < minTimestamp) minTimestamp = action.timestamp;
    if (action.timestamp > maxTimestamp) maxTimestamp = action.timestamp;
  }
  
  // Fetch all swaps once (with some buffer for finding nearby swaps)
  const BUFFER = 50000; // Buffer to ensure we find swaps before/after edge actions
  const swapsCache = await fetchAllSwapsInRange(
    Math.max(0, minBlock - BUFFER),
    maxBlock + BUFFER
  );
  
  // Fetch AERO prices from CoinGecko
  const aeroPriceMap = await fetchAeroPrices(minTimestamp, maxTimestamp);
  
  console.log(`Processing actions with cached swaps...\n`);
  
  const outputRows: OutputRow[] = [];
  const failed: Array<{ action: ActionRow; reason: string }> = [];
  
  for (let i = 0; i < filteredActions.length; i++) {
    const action = filteredActions[i];
    
    // Log progress every 100 actions instead of every action
    if (i % 100 === 0 || i === filteredActions.length - 1) {
      console.log(`[${i + 1}/${filteredActions.length}] Processing actions...`);
    }
    
    try {
      let swapEvent: SwapEvent | null = null;
      
      // For mint: find swap before
      // For others: find swap after
      if (action.action === "mint") {
        swapEvent = findClosestSwapBeforeFromCache(swapsCache, action.block_number, action.log_index);
      } else {
        swapEvent = findClosestSwapAfterFromCache(swapsCache, action.block_number, action.log_index);
      }
      
      if (!swapEvent) {
        failed.push({ action, reason: "no_swap_found" });
        continue;
      }
      
      const cbBtcPrice = calculateCbBtcPrice(swapEvent.sqrtPriceX96);
      
      // Get reward from earnings map
      let reward = 0;
      let inferredTokenId = action.token_id;
      
      if (action.action === "gauge_getReward" && !action.token_id) {
        // Infer token_id by looking at adjacent actions in the same transaction
        // gauge_getReward typically happens with gauge_withdraw or burn in the same tx
        
        // Look backwards and forwards in the filtered actions array
        for (let offset = -5; offset <= 5; offset++) {
          if (offset === 0) continue; // Skip current action
          
          const neighborIndex = i + offset;
          if (neighborIndex >= 0 && neighborIndex < filteredActions.length) {
            const neighbor = filteredActions[neighborIndex];
            
            // If same timestamp and has token_id, use it
            if (neighbor.timestamp === action.timestamp && neighbor.token_id) {
              inferredTokenId = neighbor.token_id;
              break;
            }
          }
        }
        
        // Get reward from earnings
        const getRewardData = getRewardByTimestamp.get(action.timestamp);
        reward = getRewardData?.reward || 0;
      } else {
        const earningsKey = `${action.timestamp}|${action.action}|${action.token_id}`;
        reward = earningsMap.get(earningsKey) || 0;
      }
      
      // Calculate USD values
      const amount0_usd = action.amount0_dec; // USDC is 1:1 with USD
      const amount1_usd = action.amount1_dec * cbBtcPrice;
      const aeroPrice = getAeroPrice(aeroPriceMap, action.timestamp);
      const reward_usd = reward * aeroPrice; // Real AERO price from CoinGecko
      
      outputRows.push({
        timestamp: action.timestamp,
        timestamp_excel: toExcelTimestamp(action.timestamp),
        tx_hash: action.tx_hash,
        block: action.block_number,
        block_index: action.log_index,
        swap_block: swapEvent.blockNumber,
        swap_index: swapEvent.index,
        swap_hash: swapEvent.transactionHash,
        token_id: inferredTokenId, // Use inferred token_id for gauge_getReward
        action: action.action,
        cbBTC_price: cbBtcPrice,
        AERO_price: aeroPrice,
        tick_lower: action.tick_lower,
        tick_upper: action.tick_upper,
        amount0_dec: action.amount0_dec,
        amount1_dec: action.amount1_dec,
        fee0_dec: action.fee0_dec,
        fee1_dec: action.fee1_dec,
        reward: reward,
        amount0_usd: amount0_usd,
        amount1_usd: amount1_usd,
        AERO_usd: reward_usd,
      });
    } catch (error: any) {
      failed.push({ action, reason: error.message });
    }
  }
  
  console.log();
  
  // Create output directory
  const outputDir = path.join(__dirname, "..", "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write output CSV
  if (outputRows.length > 0) {
    const outputCsv = stringify(outputRows, {
      header: true,
      columns: [
        "timestamp",
        "timestamp_excel",
        "tx_hash",
        "block",
        "block_index",
        "swap_block",
        "swap_index",
        "swap_hash",
        "token_id",
        "action",
        "cbBTC_price",
        "AERO_price",
        "tick_lower",
        "tick_upper",
        "amount0_dec",
        "amount1_dec",
        "fee0_dec",
        "fee1_dec",
        "reward",
        "amount0_usd",
        "amount1_usd",
        "AERO_usd",
      ],
    });
    
    const outputPath = path.join(outputDir, "transaction_details.csv");
    fs.writeFileSync(outputPath, outputCsv, "utf-8");
    
    console.log("=".repeat(60));
    console.log(`✓ Successfully processed ${outputRows.length} actions`);
    console.log(`✓ Output written to: ${outputPath}`);
  }
  
  if (failed.length > 0) {
    console.log(`⚠ Failed to process ${failed.length} actions`);
    
    // Write failed actions to a separate file
    const failedCsv = stringify(
      failed.map((f) => ({
        timestamp: f.action.timestamp,
        block: f.action.block_number,
        tx_hash: f.action.tx_hash,
        action: f.action.action,
        reason: f.reason,
      })),
      { header: true }
    );
    
    const failedPath = path.join(outputDir, "failed_actions.csv");
    fs.writeFileSync(failedPath, failedCsv, "utf-8");
    console.log(`  Failed actions logged to: ${failedPath}`);
  }
  
  console.log("=".repeat(60));
  console.log("Done!");
}

// Run
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});


