# quick-create-schedule-wire.ts - Condition Slot Update

## Summary
Updated `quick-create-schedule-wire.ts` to properly wire the `recurring.condition` slot into the schedule payload instead of silently dropping it.

## Changes Made

### File Modified
`tastile-web/src/shared/api/v1/quick-create-schedule-wire.ts`

### Key Modifications

1. **Removed** the warning code that silently ignored `recurring.condition`:
   ```typescript
   // OLD (removed)
   if (state.recurring.condition !== null) {
     console.warn("[Phase C/D reserved] recurring.condition ignored");
     state.recurring.conditionIgnored = true;
   }
   ```

2. **Added** condition slot wiring into `plan.completion.root`:
   ```typescript
   // NEW
   // Wire the recurring condition slot into completion.root if present
   const planRoot = state.recurring.condition !== null
     ? { ...completionRoot, ...convertCondition(state.recurring.condition) }
     : completionRoot;
   ```

3. **Uses** the `convertCondition` function from `./plan-wire` to convert the condition tree to wire format

## How It Works

- When `state.recurring.condition` is non-null, the condition tree is converted to wire format using `convertCondition()`
- The converted condition is merged into `planRoot` (the completion root)
- `planRoot` is then used as the `plan.completion.root` in the final payload
- When `state.recurring.condition` is null, `planRoot` remains unchanged

## Related Files

- `tastile-web/src/shared/api/v1/plan-wire.ts` - Contains `convertCondition()` function
- `tastile-web/src/shared/stores/quick-create-store.ts` - Defines `RecurringSlice.condition` field
