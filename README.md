# LP Returns Analysis

Analyze liquidity pool returns for Aerodrome's USDC-cbBTC pool (0x4e962BB3889Bf030368F56810A9c96B83CB3E778).

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Create a `.env` file in the project root:
   ```
   BASE_RPC_URL=rpc
   BASESCAN_API_KEY=api_key
   ```

3. **Add input data:**
   Place CSV files generated from timeline script in the `input/` directory:
   - `actions.csv`
   - `earnings_per_action.csv`

## Usage

**Step 1: Generate LP Analysis CSV**
```bash
npm start
```

This combines data from `actions.csv` + `earnings_per_action.csv`, fetches cbBTC prices from on-chain swap events, and generates `output/lp_analysis.csv`.

**Step 2: Calculate Summary Statistics**
```bash
npm run analyze
```

This reads the LP analysis CSV and calculates comprehensive return metrics, generating `output/analysis_summary.csv` with:
- Position-by-position breakdown (one row per position)
- Wallet-level totals in the last row (row_type = "wallet_summary")

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

The script generates `output/lp_analysis.csv` with:
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
- **tick_lower**, **tick_upper** - Position tick range
- **amount0_dec**, **amount1_dec** - Token amounts
- **fee0_dec**, **fee1_dec** - Collected fees
- **reward** - AERO rewards
- **amount0_usd** - USD value of USDC (1:1)
- **amount1_usd** - USD value of cbBTC
- **reward_usd** - USD value of AERO rewards (assumes 1:1)

If any actions fail to process, they'll be logged in `output/failed_actions.csv`.

## Price Logic

The script fetches cbBTC prices from on-chain swap events:
- **For mint actions:** Uses the closest swap **before** the transaction
- **For burn/collect/gauge_getReward:** Uses the closest swap **after** the transaction


## Analysis Metrics

The analysis calculates the following metrics (using formulas from the reference implementation):

### Wallet-Level Statistics
- **positions_count**: Number of unique LP positions
- **events_count**: Total number of events processed
- **total_deposit_usdc**: Total USDC deposited across all mints
- **total_deposit_cbbtc**: Total cbBTC deposited across all mints
- **total_withdraw_usdc**: Total USDC withdrawn from all burns
- **total_withdraw_cbbtc**: Total cbBTC withdrawn from all burns
- **avg_active_time_seconds**: Average time each position was active
- **total_collected_aero_rewards**: Total AERO rewards earned
- **total_impermanent_loss_usd**: Total impermanent loss
- **total_profit_usd**: Total profit/loss in USD

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

