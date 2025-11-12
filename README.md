# LP Returns Analysis

Analyze liquidity pool returns for Aerodrome's USDC-cbBTC pool (0x4e962BB3889Bf030368F56810A9c96B83CB3E778).

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `env.example` to `.env` and fill in your values:
   ```bash
   cp env.example .env
   ```
   
   Required:
   ```
   BASE_RPC_URL=your_base_rpc_url
   BASESCAN_API_KEY=your_basescan_api_key
   ```

3. **Organize input data:**
   
   The repo uses an organized folder structure for different analysis purposes:
   
   ```
   input/
   ├── copywallet-comparison/          # For comparing copy bot vs target wallet
   │   ├── copywallet/
   │   │   └── {copywalletAddress}/
   │   │       ├── actions_blocks_*.csv
   │   │       └── earnings_per_action_blocks_*.csv
   │   └── targetwallet/
   │       └── {targetwalletAddress}/
   │           ├── actions_blocks_*.csv
   │           └── earnings_per_action_blocks_*.csv
   └── topwallet-comparison/           # For batch analysis of multiple wallets
       ├── 0xAddress1/
       │   ├── actions_blocks_*.csv
       │   └── earnings_per_action_blocks_*.csv
       ├── 0xAddress2/
       └── 0xAddress3/
   ```
   
  **Note:** 
  - This script is meant to work with inputs from our timeline script outputs (see [section](#lp-returns))
  - Each wallet's CSVs must be in a folder named with their address.
   
  Output is organized by block range:
  ```
  output/
  ├── copywallet-comparison/
  │   └── {targetAddress}_{startBlock}_{endBlock}/
  │       ├── copywallet/
  │       │   ├── transaction_details_blocks_*.csv
  │       │   ├── analysis_by_position_blocks_*.csv
  │       │   └── analysis_by_day_blocks_*.csv
  │       ├── targetwallet/
  │       │   ├── transaction_details_blocks_*.csv
  │       │   ├── analysis_by_position_blocks_*.csv
  │       │   └── analysis_by_day_blocks_*.csv
  │       └── copywallet_comparison_*.csv
  └── topwallet-comparison/
      └── {startBlock}_{endBlock}/
          ├── 0xAddress1/
          │   ├── transaction_details_blocks_*.csv
          │   ├── analysis_by_position_blocks_*.csv
          │   └── analysis_by_day_blocks_*.csv
          ├── 0xAddress2/
          ├── 0xAddress3/
          └── batch_comparison_blocks_*.csv
  ```

## Usage

### Quick Start (Commands)

This repo supports **two main workflows** - each with a **single command**:

| Workflow | Purpose | Command | Output |
|----------|---------|---------|--------|
| **Compare Copy Bot** | Compare your copy bot vs target wallet | `npm run compare-copy` | `comparison_*.csv` |
| **Compare Top Wallets** | Evaluate multiple wallets to find the best performer | `npm run compare-topwallets` | `batch_comparison_*.csv` |

Both commands handle everything end-to-end: data processing, analysis, and comparison generation.

---

### Detailed Workflow Documentation

#### 1. **Compare Top Wallets - Batch Analysis** 

**Quick Command:**
```bash
npm run compare-topwallets
```

This single command will process all wallets and generate a comparison table automatically.

**Input Structure:**
```
input/topwallet-comparison/
├── 0xAddress1/
│   ├── actions_blocks_START_END.csv
│   └── earnings_per_action_blocks_START_END.csv
├── 0xAddress2/
└── 0xAddress3/
```

This will:
- Process all addresses in `input/topwallet-comparison/` automatically
- Generate individual analysis files for each address in `output/topwallet-comparison/{blockRange}/{address}/`
- Create a **comparison CSV** at `output/topwallet-comparison/{blockRange}/batch_comparison_blocks_*.csv` showing all wallets side-by-side

**Output:**
- `output/topwallet-comparison/{blockRange}/batch_comparison_blocks_*.csv` - **Side-by-side comparison with key metrics** (APR, profit, capital deployed, etc.)
- `output/topwallet-comparison/{blockRange}/{address}/transaction_details_*.csv` - Transaction details for each address
- `output/topwallet-comparison/{blockRange}/{address}/analysis_by_position_*.csv` - Position breakdown for each address
- `output/topwallet-comparison/{blockRange}/{address}/analysis_by_day_*.csv` - Daily stats for each address

**Use Case:** Quickly identify the best performing wallets to copy by comparing APR, profit margins, and efficiency metrics.

**Key Metrics in Batch Comparison:**
- **ANALYSIS METADATA**: Block range, start/end times
- **Complete Positions**: Number of positions opened and closed during the period
- **Excluded Positions**: Pre-existing or still-open positions (not included in calculations)
- **Operating Time**: Total time from first to last transaction
- **Avg Position Duration**: Average time each position was held
- **Total Deposits (USD)**: Total capital deployed
- **AERO Rewards (USD)**: Staking rewards earned
- **Impermanent Loss (USD)**: IL from price movements
- **Total Profit/Loss (USD)**: Net profit including rewards and IL
- **APR (%)**: Annualized return rate
- **Portfolio XIRR (%)**: Time-weighted annualized return

---

#### 2. **Compare Copy Bot - Single Wallet Comparison**

**Quick Command:**
```bash
npm run compare-copy
# or
npm run comparison  # (alias for backwards compatibility)
```

This single command will:
1. Process copywallet data
2. Analyze copywallet
3. Process targetwallet data
4. Analyze targetwallet
5. Generate comparison report

**Input Structure:**
```
input/copywallet-comparison/
├── copywallet/
│   ├── actions_blocks_*.csv
│   └── earnings_per_action_blocks_*.csv
└── targetwallet/
    ├── actions_blocks_*.csv
    └── earnings_per_action_blocks_*.csv
```

**Output:**
- `output/copywallet-comparison/{targetAddress}_{blockRange}/copywallet/` - Your copy bot analysis
- `output/copywallet-comparison/{targetAddress}_{blockRange}/targetwallet/` - Target wallet analysis
- `output/copywallet-comparison/{targetAddress}_{blockRange}/copywallet_comparison_*.csv` - Side-by-side comparison with ratio analysis

**Special Features:**
- **Ratio Column**: Shows the ratio between the two wallets for each metric
- **vs Expected Column**: Compares actual ratio to expected ratio
  - For **scalable metrics** (deposits, profit, AERO rewards): Expected ratio = capital ratio
  - For **efficiency metrics** (positions, APR, duration): Expected ratio = 1.0x
- Helps identify if your copy bot is performing as expected given its capital size

**Use Case:** Monitor if your copy bot is accurately replicating the target wallet's strategy and performance.

---

### Advanced Usage (Manual Step-by-Step)

If you need more control, you can run individual steps:

**For Copy Bot Comparison:**
```bash
# Process copywallet
npm start copywallet
npm run analyze copywallet

# Process targetwallet
npm start targetwallet
npm run analyze targetwallet

# Generate comparison only (without reprocessing)
npm run comparison <label1> <label2>
```

**Individual Commands:**
- `npm start [wallet]` - Process transaction data and fetch prices
- `npm run analyze [wallet]` - Calculate summary statistics
- `npm run comparison [label1] [label2]` - Compare two already-processed wallets (optional args)
- `npm run batch` - Alias for `npm run compare-topwallets`

---

## Input Files

### actions.csv
Contains LP transactions with columns:
- `timestamp` - ISO timestamp
- `block_number` - Block number
- `tx_hash` - Transaction hash
- `action` - Action type (mint, burn, collect, gauge_getReward)
- `log_index` - Log index in the block
- `token_id` - Position NFT ID
- `tick_lower`, `tick_upper` - Position tick range
- `amount0_dec`, `amount1_dec` - Token amounts (USDC, cbBTC)
- `fee0_dec`, `fee1_dec` - Collected fees

### earnings_per_action.csv
Contains reward data with columns:
- `timestamp` - ISO timestamp
- `action` - Action type
- `token_id` - Position NFT ID
- `reward` - AERO staking rewards

## Output

### transaction_details.csv

The main script generates `output/transaction_details.csv` with:
- **timestamp** - Original timestamp
- **timestamp_excel** - Excel-readable format (YYYY-MM-DD HH:MM)
- **tx_hash** - Transaction hash
- **block** - Block number
- **block_index** - Log index
- **swap_block** - Block of the swap used for pricing
- **swap_index** - Log index of the pricing swap
- **swap_hash** - Transaction hash of the pricing swap
- **token_id** - Position NFT ID
- **event_type** - Action type (mint, burn, collect, gauge_getReward)
- **cbBTC_price** - cbBTC price in USDC
- **AERO_price** - AERO price in USD (from CoinGecko API)
- **tick_lower**, **tick_upper** - Position tick range
- **amount0_dec**, **amount1_dec** - Token amounts
- **fee0_dec**, **fee1_dec** - Collected fees
- **reward** - AERO rewards
- **amount0_usd** - USD value of USDC (1:1)
- **amount1_usd** - USD value of cbBTC
- **AERO_usd** - USD value of AERO rewards (from CoinGecko API)

### analysis_by_position.csv

Position-by-position breakdown with comprehensive metrics for each LP position, plus a wallet summary row at the end. Includes deposit/withdrawal details, fees, rewards, IL, profit, and XIRR for each position.

### analysis_by_day.csv

Daily aggregated statistics showing positions opened/closed, deposits, withdrawals, fees, and AERO rewards collected each day, with a summary row at the end.

## Price Logic

The script fetches cbBTC prices from on-chain swap events:
- **For mint actions:** Uses the closest swap **before** the transaction
- **For burn/collect/gauge_getReward:** Uses the closest swap **after** the transaction


## Analysis Metrics

The analysis calculates the following metrics (using formulas from the reference implementation):

### Daily Statistics (`analysis_by_day.csv`)
Each row represents one day of trading activity:
- **date**: Calendar date (YYYY-MM-DD)
- **events_count**: Total events that day
- **positions_opened**: Number of mint events
- **positions_closed**: Number of burn events  
- **deposit_usdc / deposit_cbbtc**: Total deposited that day
- **deposit_value_usd**: Total USD value of deposits
- **withdraw_usdc / withdraw_cbbtc**: Total withdrawn that day
- **withdraw_value_usd**: Total USD value of withdrawals
- **fees_collected_usd**: Trading fees collected that day
- **aero_rewards_collected**: AERO rewards earned that day (in USD)
- **daily_income_usd**: Daily income from fees + rewards (Note: This is NOT the same as true profit - see `profit_usd` in `analysis_by_position.csv` which accounts for IL and price changes)

### Wallet-Level Statistics
- **positions_count**: Number of unique LP positions (only positions that have been closed)
- **events_count**: Total number of events processed
- **total_deposit_usdc**: Total USDC deposited across all mints
- **total_deposit_cbbtc**: Total cbBTC deposited across all mints
- **total_withdraw_usdc**: Total USDC withdrawn from all burns
- **total_withdraw_cbbtc**: Total cbBTC withdrawn from all burns
- **avg_active_time_seconds**: Average time each position was active
- **total_collected_aero_rewards**: Total AERO rewards earned
- **total_impermanent_loss_usd**: Total impermanent loss
- **total_profit_usd**: Total profit/loss in USD
- **xirr**: Portfolio XIRR (annualized return rate as %)

### Profit Calculation Formula
```
hodlValueAtDeposit = deposit_usdc + (deposit_cbbtc × btc_price_at_mint)
lpValueAtExit = withdraw_usdc + (withdraw_cbbtc × btc_price_at_burn)
profit = (lpValueAtExit - hodlValueAtDeposit) + aero_rewards
```

### Impermanent Loss Formula
```
hodlValueAtExit = deposit_usdc + (deposit_cbbtc × btc_price_at_burn)
lpValueAtExit = withdraw_usdc + (withdraw_cbbtc × btc_price_at_burn)
impermanent_loss = lpValueAtExit - hodlValueAtExit
```

### XIRR (Extended Internal Rate of Return)

The analysis calculates XIRR for both individual positions and the overall wallet portfolio. XIRR is the annualized rate of return that accounts for the timing and size of all cash flows.

**Position-Level XIRR:**
- Calculated for each closed position (with at least one mint and one burn)
- Treats mints as negative cash flows (capital deployed)
- Treats burns, fee collections, and rewards as positive cash flows (returns)
- Returns annualized rate as a percentage (e.g., 15.5%)

**Wallet-Level XIRR:**
- Aggregates all cash flows across the entire portfolio
- Only calculated when all positions are closed
- Shows "N/A" if there are open positions with deployed capital

**Cash Flow Model:**
```
Mints:      -deposit_value_usd  (outflow at mint timestamp)
Burns:      +withdrawal_value_usd  (inflow at burn timestamp)
Collects:   +fees_usd  (inflow at collect timestamp)
Rewards:    +AERO_usd  (inflow at reward timestamp)
```

**Calculation Method:**
Uses Newton method to solve for the rate `r` where Net Present Value (NPV) = 0:
```
NPV = Σ (cash_flow_i / (1 + r)^(days_i / 365))
```