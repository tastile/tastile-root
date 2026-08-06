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

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-08-06 | Initial schema definition |
