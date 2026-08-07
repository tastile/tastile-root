# Cold Reset Schema Definition

A comprehensive schema for defining cold reset mechanisms across systems.

---

## Schema Definition

### 1. Cold Reset Core Types

| Type | Description |
|------|-------------|
| cold_boot | Physical power cycle, complete system reset |
| cache_clear | Clear all caches, restart application |
| state_wipe | Wipe persistent state, restart application |
| memory_dump | Dump memory state before reset (debugging) |
| service_restart | Restart services, retain some state |

### 2. Cold Reset Metadata Structure

```yaml
cold_reset:
  id: string           # Unique identifier (UUID recommended)
  type: string         # From cold_reset_types above
  timestamp: timestamp # ISO 8601 format
  initiator: string    # Who/what triggered the reset
  target: string       # Target system/component
  scope: string        # "full" | "partial" | "isolated"
  reason: string       # Why the reset was performed
  status: string       # "pending" | "in_progress" | "completed" | "failed" | "cancelled"
```

### 3. Pre-Reset Conditions Check

| Check | Threshold | Action If Failed |
|-------|-----------|------------------|
| disk_free | 10GB | abort |
| memory_available | 2GB | abort |
| backup_created | - | warn |
| uncommitted_changes | - | abort |

### 4. Cold Reset Execution Flow

#### Preparation Phase
- notify_stakeholders
- save_session_state
- log_current_state
- backup_critical_data

#### Validation Phase
- run_pre_conditions
- verify_backup
- check_dependencies

#### Execution Phase
- clear_temp_files
- flush_caches
- stop_services
- execute_reset_action
- release_resources

#### Post-Process Phase
- start_services
- restore_session_if_needed
- log_reset_completion

#### Verification Phase
- verify_integrity
- run_health_checks
- notify_completion

### 5. Cold Reset Payload

```yaml
cold_reset_payload:
  id: string
  type: string
  command: string
  args: []
  environment:
    vars: {}
    paths: {}
    libraries: []
  constraints:
    max_time: seconds
    max_memory: GB
    allowed_hosts: []
  retries:
    max_attempts: 3
    backoff_seconds: 5
    exponential_multiplier: 2
```

### 6. Cold Reset Notification Schema

```yaml
notification:
  type: string        # "info" | "warning" | "error" | "critical"
  channels:           # ["console", "email", "slack", "sms", "dashboard"]
    - string
  recipients:         # []
    - string
  template: string
  variables: {}
  scheduled: boolean
  scheduled_delay: seconds
```

### 7. Cold Reset Result Schema

```yaml
reset_result:
  reset_id: string
  status:             # "success" | "partial_success" | "failed" | "timeout"
  metrics:
    duration: seconds
    resources_freed: {}
    data_cleared: {}
  artifacts:
    - "pre_reset_snapshot"
    - "post_reset_snapshot"
    - "error_logs"
    - "verification_report"
  rollbacks:
    available: boolean
    methods: []
    time_limit: seconds
```

---

## Schema Validation Rules

### Required Fields
- id
- type
- timestamp
- initiator
- target
- status

### Allowed Values

| Field | Allowed Values |
|-------|----------------|
| type | cold_boot, cache_clear, state_wipe, memory_dump, service_restart |
| scope | full, partial, isolated |
| status | pending, in_progress, completed, failed, cancelled |

### Forbidden Combinations
- type: "cold_boot" with scope: "isolated" (Invalid)
- type: "state_wipe" with backup_created: false (Should fail)

---

## API Interface

### ColdResetAPI Class

```python
class ColdResetAPI:
    """Cold Reset System Interface"""
    
    def create_reset(
        reset_type: str,
        target: str,
        payload: dict,
        notification: dict
    ) -> ResetID:
        """Create a new cold reset operation"""
    
    def trigger_reset(
        reset_id: str,
        execute_immediately: bool = True
    ) -> bool:
        """Execute a queued cold reset"""
    
    def check_conditions(
        reset_id: str,
        pre_check: str
    ) -> ValidationResult:
        """Pre-reset condition check"""
    
    def get_reset_status(
        reset_id: str
    ) -> ResetStatus:
        """Get current reset status and metrics"""
    
    def rollback_reset(
        reset_id: str,
        method: str
    ) -> bool:
        """Rollback a completed reset if available"""
```

---

## Configuration Schema

```yaml
cold_reset_config:
  default_scope: "full"
  default_timeout: 300
  allowed_types:
    - "cache_clear"
    - "service_restart"
  auto_recover: true
  recovery_delay: 60
  max_concurrent: 1
  logging:
    level: "INFO"
    rotate: true
    retention_days: 30
  notifications:
    enabled: true
    channels: ["console", "dashboard"]
  backup:
    required: false
    max_age_hours: 24
    compression: true
```

---

## Security Considerations

```yaml
security:
  authentication_required: true
  authorization_roles:
    - "admin"
    - "operator"
    - "monitor"
  audit_logging: true
  approval_workflow:
    enabled: true
    required_approvers: 2
    max_approval_time_hours: 4
  rate_limiting:
    per_user: 10_per_day
    per_system: 5_per_hour
```

---

## Example Usage

```yaml
operation:
  id: "reset-20260806-001"
  type: "cache_clear"
  target: "web-server-01"
  scope: "full"
  reason: "High memory usage detected"
  status: "pending"
  
  payload:
    command: "clear_cache"
    args: ["--force", "--verbose"]
    environment:
      VAR1: "value1"
  
  notifications:
    type: "info"
    channels: ["dashboard", "email"]
    recipients: ["admin@example.com"]
```

---

## G8b cold reset

Concrete application of this schema to the `tastile-core` wslc dev stack.
Tracked as `tastile/tastile-core#103`. Canonical plan:
`tastile-core/docs/plans/G8b-cold-reset.md`.

- `type`: `state_wipe` — `scope`: `full` — target: local wslc `tastile-pgdata`
- **Destructive execution requires explicit user confirmation.** Per the issue's
  リスク section: "Volume wipe は不可逆" and "対話的セッションでは必ずユーザー確認を先に取り".
  Do not run while another agent, E2E run, or test run depends on the volume.
- Never run this against production / RDS.

### Container names

The issue and plan text say `tastile-v1-api` / `tastile-v1-worker`. The actual
stack created by `tastile-core/scripts/wslc/up-v1.sh` uses `tastile-db`,
`tastile-api`, `tastile-worker` (`tastile-v1-api` is the *image* name, not a
container name). Use the actual names when executing or verifying.

### Procedure

1. Confirm blast radius. Verify this is the dev environment and no parallel test
   run depends on the volume. `wslc volume ls` + `wslc container ls` to confirm
   the exact names. Get explicit user approval before removing the volume.
2. Stop the running stack:
   ```bash
   cd tastile-core
   bash scripts/wslc/down.sh
   ```
   `down.sh` stops `tastile-worker`, `tastile-api`, `tastile-db` and
   intentionally preserves `tastile-pgdata` and `tastile-net`.
3. Remove the Postgres data volume (irreversible):
   ```bash
   wslc volume rm tastile-pgdata
   ```
   If removal fails, find the container still holding it. Do not guess at a
   different volume name.
4. Remove leftover containers so no old migration state, env, or exit state
   carries over:
   ```bash
   wslc container rm tastile-db tastile-api tastile-worker 2>/dev/null || true
   ```
5. Rebuild the image **only if** `Containerfile.v1` changed, a crate `Cargo.toml`
   added dependencies, or `crates-v1/api/Cargo.toml` `rust-version` changed.
   Cold build takes 5-10 minutes:
   ```bash
   bash scripts/wslc/build.sh
   ```
   Expected: `tastile-v1-api:latest` produced with exit code 0.
6. Export the web bridge secret so API and web agree. Never echo the value into
   logs, plans, or commits:
   ```bash
   BRIDGE_SECRET=$(grep TASTILE_WEB_BRIDGE_SECRET ../tastile-web/.env.development | cut -d= -f2)
   export BRIDGE_SECRET
   ```
7. Bring the stack back up (recreates `tastile-pgdata`):
   ```bash
   bash scripts/wslc/up-v1.sh
   ```

### Verification

```bash
curl -i http://127.0.0.1:31400/v1/health                                  # HTTP 200
wslc container exec tastile-db psql -U tastile -d tastile_db -c "\dt"     # >= N v1_* tables
wslc container exec tastile-api printenv | grep BRIDGE                    # name only, not value
wslc container ls                                                          # 3 containers running
```

N is the count of applied `v1_*` migrations for this environment — read it from
the migration files / startup log, do not hardcode a guessed number.

Also confirm the corruption symptoms are gone: no `column already exists` /
`relation already exists` in the migration log, no `UNIQUE constraint` on
`v1_subject(id)` during seed, no `relation "v1_xxx" does not exist` test
failures, and no Postgres crash-loop on `could not open relation mapping file`.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-08-06 | Initial schema definition |
| 1.1.0 | 2026-08-07 | Add G8b cold reset procedure (tastile-core#103) |
