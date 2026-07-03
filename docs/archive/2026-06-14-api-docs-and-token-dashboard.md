# API Documentation & Access Token Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Document the tastile-core API as OpenAPI 3.1, publish it at `tastile.app/docs/api`, and add an access token management section to the Account page.

**Architecture:** Create a static OpenAPI spec from the existing axum router endpoints, render it with Scalar (modern OpenAPI viewer), and add a "Tokens" tab to the existing Account page that shows the user's Cognito id_token (which doubles as the API key). The token is retrieved via the existing `/api/auth/session` endpoint.

**Tech Stack:** OpenAPI 3.1 YAML, Scalar (@scalar/api-reference), Next.js App Router, existing Cognito cookie-based auth.

---

## Task 1: Create OpenAPI 3.1 Specification

**Files:**
- Create: `tastile-web/public/openapi.yaml`

**Step 1: Create the OpenAPI spec file**

Write `tastile-web/public/openapi.yaml` covering all endpoints from `tastile-core/crates/tastile-api/src/router.rs`:

```yaml
openapi: 3.1.0
info:
  title: Tastile API
  version: 0.1.0
  description: |
    Execution control API for Tastile.
    
    ## Authentication
    All protected endpoints require a Cognito JWT Bearer token.
    Obtain a token via the OAuth flow or email/password sign-in.
    
    Include the token in the `Authorization` header:
    ```
    Authorization: Bearer <your-access-token>
    ```
    
    For SSE endpoints, pass the token as a query parameter:
    ```
    ?access_token=<your-access-token>
    ```
    
    The access token is your API key. Retrieve it from Account Settings > Tokens.
  contact:
    name: Tastile
    url: https://tastile.app
  license:
    name: Proprietary

servers:
  - url: https://api.tastile.app
    description: Production
  - url: http://127.0.0.1:3140
    description: Local daemon

security:
  - BearerAuth: []

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: Cognito JWT access token. Obtain via OAuth or email sign-in.

  schemas:
    Error:
      type: object
      properties:
        error:
          type: string
      required: [error]

    CommandResponse:
      type: object
      properties:
        ok:
          type: boolean
        events:
          type: array
          items:
            type: string
        tile_id:
          type: string
          format: uuid
        prompt:
          type: object
        error:
          type: string

    TileView:
      type: object
      properties:
        id:
          type: string
          format: uuid
        title:
          type: string
        lifecycle:
          type: string
          enum: [ready, started, done, closed]
        next_action:
          type: string
          nullable: true
        done_definition:
          type: string
          nullable: true
        worked_minutes:
          type: integer
        break_minutes:
          type: integer
        semantic_role:
          type: string
          enum: [work, break, label]
        labels:
          type: array
          items:
            type: string
        objective_mode:
          type: string
        target_work_min:
          type: integer
          nullable: true
        target_rest_min:
          type: integer
          nullable: true
        done_rule:
          type: string
          nullable: true
        resume_note:
          type: string
          nullable: true
        prompt:
          $ref: '#/components/schemas/PromptView'
        projected_next_start_at:
          type: string
          format: date-time
          nullable: true
        temporal:
          $ref: '#/components/schemas/TemporalConditions'
        objective:
          $ref: '#/components/schemas/ObjectiveConditions'
        interruption:
          $ref: '#/components/schemas/InterruptionConditions'
        automation:
          $ref: '#/components/schemas/AutomationConditions'
        annotation:
          $ref: '#/components/schemas/AnnotationConditions'
        recurrence:
          type: object
          nullable: true
          properties:
            step_min:
              type: integer
            window_start_min:
              type: integer
            window_end_min:
              type: integer
            expression:
              type: string
              nullable: true

    TemporalConditions:
      type: object
      properties:
        fixed_start:
          type: string
          format: date-time
          nullable: true
        fixed_end:
          type: string
          format: date-time
          nullable: true
        active_start:
          type: string
          format: date-time
          nullable: true
        active_end:
          type: string
          format: date-time
          nullable: true
        release_at:
          type: string
          format: date-time
          nullable: true
        due_at:
          type: string
          format: date-time
          nullable: true

    ObjectiveConditions:
      type: object
      properties:
        objective_mode:
          type: string
        target_work_min:
          type: integer
          nullable: true
        target_rest_min:
          type: integer
          nullable: true
        done_rule:
          type: string
          nullable: true
        recurrence:
          type: object
          nullable: true

    InterruptionConditions:
      type: object
      properties:
        break_splits_work:
          type: boolean

    AutomationConditions:
      type: object
      properties:
        auto_start:
          type: boolean
        auto_complete:
          type: boolean

    AnnotationConditions:
      type: object
      properties:
        semantic_role:
          type: string
          enum: [work, break, label]
        labels:
          type: array
          items:
            type: string

    PromptView:
      type: object
      properties:
        prompt_id:
          type: string
        kind:
          type: string
          enum: [start, end, break_end]
        severity:
          type: string
          enum: [soft, elevated, critical]
        tile_id:
          type: string
          nullable: true
        title:
          type: string
        body:
          type: string
        why:
          type: string
        suggested_minutes:
          type: integer
          nullable: true
        reasons:
          type: array
          items:
            type: string
        actions:
          type: array
          items:
            type: object
            properties:
              id:
                type: string
              label:
                type: string
        default_action_id:
          type: string
          nullable: true
        created_at:
          type: string
          format: date-time
          nullable: true
        triggered_at:
          type: string
          format: date-time
          nullable: true
        default_action_applied_at:
          type: string
          format: date-time
          nullable: true
        expires_at:
          type: string
          format: date-time
          nullable: true
        stale:
          type: boolean

    SessionResponse:
      type: object
      properties:
        user_id:
          type: string
        email:
          type: string
        access_token:
          type: string
        refresh_token:
          type: string
        provider_token:
          type: string
          nullable: true
        provider_refresh_token:
          type: string
          nullable: true
        expires_at:
          type: string
          format: date-time
          nullable: true

  paths:
    /health:
      get:
        tags: [Operational]
        summary: Health check
        security: []
        responses:
          '200':
            description: OK
            content:
              text/plain:
                schema:
                  type: string
                  example: ok

    /ready:
      get:
        tags: [Operational]
        summary: Readiness check
        security: []
        responses:
          '200':
            description: Ready
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    ready:
                      type: boolean

    /version:
      get:
        tags: [Operational]
        summary: Version info
        security: []
        responses:
          '200':
            description: Version
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    version:
                      type: string
                    app:
                      type: string
                    binary_sha256:
                      type: string

    /auth/signin:
      post:
        tags: [Auth]
        summary: Sign in with email/password
        security: []
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  email:
                    type: string
                    format: email
                  password:
                    type: string
                required: [email, password]
        responses:
          '200':
            description: Session
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/SessionResponse'

    /auth/signup:
      post:
        tags: [Auth]
        summary: Sign up with email/password
        security: []
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  email:
                    type: string
                    format: email
                  password:
                    type: string
                required: [email, password]
        responses:
          '200':
            description: Session
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/SessionResponse'

    /auth/signout:
      post:
        tags: [Auth]
        summary: Sign out
        responses:
          '200':
            description: OK

    /auth/session:
      get:
        tags: [Auth]
        summary: Get current session
        responses:
          '200':
            description: Session or null
            content:
              application/json:
                schema:
                  oneOf:
                    - $ref: '#/components/schemas/SessionResponse'
                    - type: 'null'

    /auth/oauth/start:
      post:
        tags: [Auth]
        summary: Start OAuth flow
        security: []
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  provider:
                    type: string
                    example: google
                  scopes:
                    type: string
                  query_params:
                    type: object
                    additionalProperties:
                      type: string
                required: [provider]
        responses:
          '200':
            description: OAuth URL
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    auth_url:
                      type: string
                      format: uri
                    flow_id:
                      type: string
                    provider:
                      type: string

    /auth/oauth/status:
      get:
        tags: [Auth]
        summary: Check OAuth flow status
        security: []
        parameters:
          - name: flow_id
            in: query
            required: true
            schema:
              type: string
        responses:
          '200':
            description: Status
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    flow_id:
                      type: string
                    completed:
                      type: boolean
                    error:
                      type: string
                      nullable: true

    /auth/oauth/exchange:
      post:
        tags: [Auth]
        summary: Exchange OAuth code
        security: []
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: string
                  state:
                    type: string
                required: [code]
        responses:
          '200':
            description: Session
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/SessionResponse'

    /auth/session/restore:
      post:
        tags: [Auth]
        summary: Restore session from client
        security: []
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  user_id:
                    type: string
                  email:
                    type: string
                  access_token:
                    type: string
                  refresh_token:
                    type: string
                  provider_token:
                    type: string
                  provider_refresh_token:
                    type: string
                  expires_at:
                    type: string
                required: [user_id, email, access_token, refresh_token]
        responses:
          '200':
            description: Session
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/SessionResponse'

    /auth/tile-quota:
      get:
        tags: [Auth]
        summary: Get tile quota
        responses:
          '200':
            description: Quota
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    plan:
                      type: string
                    tile_count:
                      type: integer
                    max_tiles:
                      type: integer
                    remaining_tiles:
                      type: integer
                    limit_reached:
                      type: boolean
                    source:
                      type: string

    /commands/tile/create:
      post:
        tags: [Commands]
        summary: Create a tile
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  title:
                    type: string
                  next_action:
                    type: string
                  done_definition:
                    type: string
                  temporal:
                    $ref: '#/components/schemas/TemporalConditions'
                  objective:
                    $ref: '#/components/schemas/ObjectiveConditions'
                  interruption:
                    $ref: '#/components/schemas/InterruptionConditions'
                  automation:
                    $ref: '#/components/schemas/AutomationConditions'
                  annotation:
                    $ref: '#/components/schemas/AnnotationConditions'
                  conflict_resolution:
                    type: string
                    enum: [keep_overlap, auto_nearest, auto_next_day, manual_adjust]
                required: [title]
        responses:
          '201':
            description: Created
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'
          '409':
            description: Conflict (fixed-time overlap)
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/tile/start:
      post:
        tags: [Commands]
        summary: Start a tile
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  tile_id:
                    type: string
                    format: uuid
                required: [tile_id]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/tile/complete:
      post:
        tags: [Commands]
        summary: Complete a tile
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  tile_id:
                    type: string
                    format: uuid
                  next_tile_id:
                    type: string
                    format: uuid
                  scope:
                    type: string
                    enum: [tile, phase]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/tile/defer:
      post:
        tags: [Commands]
        summary: Defer a tile
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  tile_id:
                    type: string
                    format: uuid
                  reason:
                    type: string
                  minutes:
                    type: integer
                required: [tile_id]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/tile/delete:
      post:
        tags: [Commands]
        summary: Delete a tile
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  tile_id:
                    type: string
                    format: uuid
                required: [tile_id]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/tile/update:
      post:
        tags: [Commands]
        summary: Update a tile (delete + recreate)
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  tile_id:
                    type: string
                    format: uuid
                  title:
                    type: string
                  next_action:
                    type: string
                  done_definition:
                    type: string
                  temporal:
                    $ref: '#/components/schemas/TemporalConditions'
                  objective:
                    $ref: '#/components/schemas/ObjectiveConditions'
                  interruption:
                    $ref: '#/components/schemas/InterruptionConditions'
                  automation:
                    $ref: '#/components/schemas/AutomationConditions'
                  annotation:
                    $ref: '#/components/schemas/AnnotationConditions'
                required: [tile_id]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/tile/extend:
      post:
        tags: [Commands]
        summary: Extend active tile phase
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  delta_min:
                    type: integer
                  reason:
                    type: string
                required: [delta_min]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/memo/attach:
      post:
        tags: [Commands]
        summary: Attach a memo to a tile
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  tile_id:
                    type: string
                    format: uuid
                  text:
                    type: string
                  memo_kind:
                    type: string
                    enum: [resume_note, scratch, log]
                required: [text]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/break/start:
      post:
        tags: [Commands]
        summary: Start a break
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  break_min:
                    type: integer
                  reason:
                    type: string
                  insertion_mode:
                    type: string
                    enum: [parallel, split, split_and_extend]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/break/end:
      post:
        tags: [Commands]
        summary: End current break
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/prompt/respond-startup-recovery:
      post:
        tags: [Commands]
        summary: Respond to startup recovery prompt
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  prompt_id:
                    type: string
                  tile_id:
                    type: string
                    format: uuid
                  action_id:
                    type: string
                    enum: [CONFIRM_CONTINUE, CONFIRM_STOP_AT, CONFIRM_EXECUTED, CONFIRM_SKIPPED, DISMISS]
                  stop_at:
                    type: string
                    format: date-time
                required: [prompt_id, tile_id, action_id]
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/CommandResponse'

    /commands/prompt/request:
      post:
        tags: [Commands]
        summary: Request a prompt for a specific tile
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  tile_id:
                    type: string
                    format: uuid
                required: [tile_id]
        responses:
          '200':
            description: Prompt
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    ok:
                      type: boolean
                    prompt:
                      $ref: '#/components/schemas/PromptView'
                    error:
                      type: string
                      nullable: true

    /commands/tick:
      post:
        tags: [Commands]
        summary: Trigger a tick now
        responses:
          '202':
            description: Accepted

    /commands/tick-at:
      post:
        tags: [Commands]
        summary: Trigger a tick at specific time
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  at:
                    type: string
                    format: date-time
                required: [at]
        responses:
          '202':
            description: Accepted

    /commands/tick-range:
      post:
        tags: [Commands]
        summary: Trigger ticks in a time range
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  start_at:
                    type: string
                    format: date-time
                  end_at:
                    type: string
                    format: date-time
                  step_seconds:
                    type: integer
                    default: 60
                required: [start_at, end_at]
        responses:
          '202':
            description: Accepted

    /read/tiles:
      get:
        tags: [Read]
        summary: List tiles
        parameters:
          - name: view_mode
            in: query
            schema:
              type: string
              default: by_state
              enum: [by_state, by_group, by_project, by_tag]
          - name: lifecycle
            in: query
            schema:
              type: string
              enum: [ready, started, done, closed]
          - name: limit
            in: query
            schema:
              type: integer
          - name: search
            in: query
            schema:
              type: string
          - name: exclude_future
            in: query
            schema:
              type: boolean
              default: false
        responses:
          '200':
            description: Tiles
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    tiles:
                      type: array
                      items:
                        $ref: '#/components/schemas/TileView'
                    next_actionable_tile_id:
                      type: string
                      nullable: true
                    next_actionable_start_at:
                      type: string
                      format: date-time
                      nullable: true

    /read/tile/{id}:
      get:
        tags: [Read]
        summary: Get tile by ID
        parameters:
          - name: id
            in: path
            required: true
            schema:
              type: string
              format: uuid
        responses:
          '200':
            description: Tile or null
            content:
              application/json:
                schema:
                  oneOf:
                    - $ref: '#/components/schemas/TileView'
                    - type: 'null'

    /read/tile/{id}/editable:
      get:
        tags: [Read]
        summary: Get editable tile by ID
        parameters:
          - name: id
            in: path
            required: true
            schema:
              type: string
              format: uuid
        responses:
          '200':
            description: Editable tile or null
            content:
              application/json:
                schema:
                  type: object
                  nullable: true
                  properties:
                    id:
                      type: string
                    title:
                      type: string
                    next_action:
                      type: string
                      nullable: true
                    done_definition:
                      type: string
                      nullable: true
                    temporal:
                      $ref: '#/components/schemas/TemporalConditions'
                    objective:
                      $ref: '#/components/schemas/ObjectiveConditions'
                    interruption:
                      $ref: '#/components/schemas/InterruptionConditions'
                    automation:
                      $ref: '#/components/schemas/AutomationConditions'
                    annotation:
                      $ref: '#/components/schemas/AnnotationConditions'

    /read/tiles-in-progress:
      get:
        tags: [Read]
        summary: Tiles in progress
        responses:
          '200':
            description: In-progress tiles
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    tiles:
                      type: array
                      items:
                        $ref: '#/components/schemas/TileView'
                    count:
                      type: integer

    /read/active-tile:
      get:
        tags: [Read]
        summary: Get active tile
        responses:
          '200':
            description: Active tile
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    tile:
                      $ref: '#/components/schemas/TileView'
                    phase:
                      type: string
                      enum: [work, break, idle]
                    phase_started_at:
                      type: string
                      format: date-time
                      nullable: true
                    phase_ends_at:
                      type: string
                      format: date-time
                      nullable: true
                    resume_note:
                      type: string
                      nullable: true
                    next_visible_action:
                      type: string
                      nullable: true

    /read/execution:
      get:
        tags: [Read]
        summary: Get execution state
        responses:
          '200':
            description: Execution
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    active_tile_id:
                      type: string
                      nullable: true
                    phase_kind:
                      type: string
                    phase_started_at:
                      type: string
                      format: date-time
                      nullable: true
                    phase_ends_at:
                      type: string
                      format: date-time
                      nullable: true
                    pending_prompt_id:
                      type: string
                      nullable: true
                    tile_count:
                      type: integer
                    event_count:
                      type: integer

    /read/execution-view:
      get:
        tags: [Read]
        summary: Get full execution view
        responses:
          '200':
            description: Execution view
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    tiles_in_progress:
                      type: array
                      items:
                        $ref: '#/components/schemas/TileView'
                    main_tile:
                      $ref: '#/components/schemas/TileView'
                    is_working:
                      type: boolean
                    is_on_break:
                      type: boolean
                    is_idle:
                      type: boolean
                    main_tile_started_at:
                      type: string
                      format: date-time
                      nullable: true
                    main_tile_ends_at:
                      type: string
                      format: date-time
                      nullable: true
                    pending_prompt_id:
                      type: string
                      nullable: true
                    pending_prompt_default_action_in_progress:
                      type: boolean
                    tile_count:
                      type: integer
                    event_count:
                      type: integer

    /read/events/state:
      get:
        tags: [Read]
        summary: SSE event stream
        description: |
          Server-Sent Events stream for real-time state updates.
          
          Since browser EventSource cannot set headers, pass the token as a query parameter:
          ```
          GET /read/events/state?access_token=<jwt>
          ```
        parameters:
          - name: access_token
            in: query
            schema:
              type: string
        responses:
          '200':
            description: SSE stream
            content:
              text/event-stream:
                schema:
                  type: string

    /views/tile-list:
      get:
        tags: [Views]
        summary: Tile list view (alias for /read/tiles)
        parameters:
          - $ref: '#/components/parameters/ViewMode'
          - $ref: '#/components/parameters/Lifecycle'
          - $ref: '#/components/parameters/Limit'
          - $ref: '#/components/parameters/Search'
          - $ref: '#/components/parameters/ExcludeFuture'
        responses:
          '200':
            description: Tiles
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    tiles:
                      type: array
                      items:
                        $ref: '#/components/schemas/TileView'
                    next_actionable_tile_id:
                      type: string
                      nullable: true
                    next_actionable_start_at:
                      type: string
                      format: date-time
                      nullable: true

    /views/active-tile:
      get:
        tags: [Views]
        summary: Active tile view (alias for /read/active-tile)
        responses:
          '200':
            description: Active tile
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    tile:
                      $ref: '#/components/schemas/TileView'
                    phase:
                      type: string
                    phase_started_at:
                      type: string
                      format: date-time
                      nullable: true
                    phase_ends_at:
                      type: string
                      format: date-time
                      nullable: true
                    resume_note:
                      type: string
                      nullable: true
                    next_visible_action:
                      type: string
                      nullable: true

    /views/pending-prompt:
      get:
        tags: [Views]
        summary: Current pending prompt
        responses:
          '200':
            description: Prompt
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    prompt:
                      $ref: '#/components/schemas/PromptView'

    /views/timeline/today:
      get:
        tags: [Views]
        summary: Today's timeline
        responses:
          '200':
            description: Timeline
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    items:
                      type: array
                      items:
                        type: object
                        properties:
                          kind:
                            type: string
                            enum: [work, break, label, scheduled]
                          tile_id:
                            type: string
                            nullable: true
                          semantic_role:
                            type: string
                            nullable: true
                          title:
                            type: string
                          started_at:
                            type: string
                            format: date-time
                          ended_at:
                            type: string
                            format: date-time
                            nullable: true
                          duration_min:
                            type: integer
                          is_active:
                            type: boolean

    /views/calendar/{range}:
      get:
        tags: [Views]
        summary: Calendar projection
        parameters:
          - name: range
            in: path
            required: true
            schema:
              type: string
              enum: [day, week, month, year]
          - name: anchor
            in: query
            schema:
              type: string
              format: date-time
          - name: tz_offset
            in: query
            schema:
              type: integer
        responses:
          '200':
            description: Calendar projection
            content:
              application/json:
                schema:
                  type: object

    /prompts/current:
      get:
        tags: [Views]
        summary: Current prompt (alias for /views/pending-prompt)
        responses:
          '200':
            description: Prompt
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    prompt:
                      $ref: '#/components/schemas/PromptView'

    /read/runtime-paths:
      get:
        tags: [Operational]
        summary: Runtime paths
        security: []
        responses:
          '200':
            description: Paths
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    profile_name:
                      type: string
                    app_data_dir:
                      type: string
                    db_path:
                      type: string
                    session_path:
                      type: string
                    daemon_startup_log_path:
                      type: string
                    daemon_executable_path:
                      type: string

    /debug/events:
      get:
        tags: [Debug]
        summary: All events (debug)
        responses:
          '200':
            description: Events
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    events:
                      type: array
                      items:
                        type: object
                    count:
                      type: integer

  parameters:
    ViewMode:
      name: view_mode
      in: query
      schema:
        type: string
        default: by_state
    Lifecycle:
      name: lifecycle
      in: query
      schema:
        type: string
    Limit:
      name: limit
      in: query
      schema:
        type: integer
    Search:
      name: search
      in: query
      schema:
        type: string
    ExcludeFuture:
      name: exclude_future
      in: query
      schema:
        type: boolean
        default: false

tags:
  - name: Operational
    description: Health, readiness, and version endpoints
  - name: Auth
    description: Authentication and session management
  - name: Commands
    description: Tile and execution commands
  - name: Read
    description: Read-only state queries
  - name: Views
    description: Derived view endpoints
  - name: Debug
    description: Debug endpoints (non-production only)
```

**Step 2: Verify the YAML is valid**

Run: `npx @redocly/cli lint tastile-web/public/openapi.yaml` (or just verify manually that structure is correct)

**Step 3: Commit**

```bash
git add tastile-web/public/openapi.yaml
git commit -m "docs: add OpenAPI 3.1 spec for tastile-core API"
```

---

## Task 2: Add Scalar OpenAPI Viewer Page

**Files:**
- Create: `tastile-web/src/app/docs/api/page.tsx`
- Modify: `tastile-web/package.json` (add @scalar/api-reference)

**Step 1: Install Scalar**

Run: `bun add @scalar/api-reference` in `tastile-web/`

**Step 2: Create the API docs page**

Create `tastile-web/src/app/docs/api/page.tsx`:

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'API Reference | Tastile',
  description: 'Tastile API reference documentation. Control your execution engine programmatically.',
}

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen">
      <script
        id="api-reference"
        type="application/json"
        data-url="/openapi.yaml"
      />
      <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference" />
    </div>
  )
}
```

**Step 3: Add layout for public access**

The `/docs/api` route must be accessible without auth. Check `middleware.ts` to ensure it's not gated. If it is, add it to the public routes list.

**Step 4: Verify**

Run: `bun run build` and confirm the page renders at `/docs/api`.

**Step 5: Commit**

```bash
git add tastile-web/src/app/docs/api/page.tsx tastile-web/package.json
git commit -m "feat: add API reference page at /docs/api using Scalar"
```

---

## Task 3: Add Access Token Tab to Account Page

**Files:**
- Modify: `tastile-web/src/app/dashboard/account/page.tsx`
- Create: `tastile-web/src/components/account/AccessTokenSection.tsx`

**Step 1: Create AccessTokenSection component**

Create `tastile-web/src/components/account/AccessTokenSection.tsx`:

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { Copy, Check, Eye, EyeOff } from 'lucide-react'

type SessionData = {
  idToken: string
  refreshToken: string
  sub: string
  exp: number
}

export function AccessTokenSection() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    void fetchSession()
  }, [])

  async function fetchSession() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      if (!res.ok) {
        setError('セッションを取得できませんでした。')
        setLoading(false)
        return
      }
      const data = (await res.json()) as SessionData
      setSession(data)
    } catch {
      setError('セッションの取得に失敗しました。')
    }
    setLoading(false)
  }

  const handleCopy = useCallback(async () => {
    if (!session?.idToken) return
    await navigator.clipboard.writeText(session.idToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [session])

  const isExpired = session ? Date.now() / 1000 > session.exp : false

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Access Token</h2>
        <p className="mt-1 text-foreground-muted">
          APIリクエストに使用するアクセストークンです。BearerトークンとしてAuthorizationヘッダーに含めて使用します。
        </p>
      </div>

      {loading && (
        <p className="text-sm text-foreground-subtle">読み込み中...</p>
      )}

      {error && (
        <div className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {session && !loading && (
        <section className="rounded-lg bg-surface-2 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">API Key</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-foreground hover:bg-surface-0"
              >
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {visible ? '非表示' : '表示'}
              </button>
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={isExpired}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover disabled:opacity-60"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'コピー済み' : 'コピー'}
              </button>
            </div>
          </div>

          <div className="rounded-md bg-surface-0 p-4">
            <p className="mb-2 text-xs text-foreground-subtle">Authorizationヘッダー:</p>
            <code className="block break-all font-mono text-xs text-foreground">
              {visible
                ? `Bearer ${session.idToken}`
                : 'Bearer ••••••••••••••••••••••••••••••••'}
            </code>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-foreground-subtle">User ID</dt>
              <dd className="mt-1 break-all font-mono text-xs text-foreground">{session.sub}</dd>
            </div>
            <div>
              <dt className="text-foreground-subtle">有効期限</dt>
              <dd className={`mt-1 font-medium ${isExpired ? 'text-danger' : 'text-foreground'}`}>
                {new Date(session.exp * 1000).toLocaleString('ja-JP')}
                {isExpired && ' (期限切れ)'}
              </dd>
            </div>
          </dl>

          <div className="rounded-md bg-surface-3 p-4 text-xs text-foreground-muted space-y-2">
            <p className="font-semibold text-foreground">使用方法</p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all">{`curl -H "Authorization: Bearer <your-token>" \\
  ${typeof window !== 'undefined' ? window.location.origin : 'https://api.tastile.app'}/read/tiles`}</pre>
            <p>
              SSE接続時はクエリパラメータとして渡します:
              <br />
              <code className="text-foreground">/read/events/state?access_token=&lt;your-token&gt;</code>
            </p>
          </div>

          <button
            type="button"
            onClick={() => void fetchSession()}
            className="text-sm text-foreground-muted hover:text-foreground"
          >
            再読み込み
          </button>
        </section>
      )}
    </div>
  )
}
```

**Step 2: Add Tokens tab to Account page**

Modify `tastile-web/src/app/dashboard/account/page.tsx`:

1. Import `AccessTokenSection`:
```tsx
import { AccessTokenSection } from '@/components/account/AccessTokenSection'
```

2. Add `'tokens'` to `TabId` type:
```tsx
type TabId = 'profile' | 'subscription' | 'statistics' | 'usage' | 'tokens'
```

3. Add tab entry:
```tsx
const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'statistics', label: 'Statistics' },
  { id: 'usage', label: 'Usage' },
  { id: 'tokens', label: 'Tokens' },
]
```

4. Add tab content (after the `usage` tab block):
```tsx
{activeTab === 'tokens' && <AccessTokenSection />}
```

**Step 3: Verify**

Run: `bun run typecheck && bun run build`

**Step 4: Commit**

```bash
git add tastile-web/src/app/dashboard/account/page.tsx tastile-web/src/components/account/AccessTokenSection.tsx
git commit -m "feat: add access token management tab to account page"
```

---

## Task 4: Ensure /docs/api is Public

**Files:**
- Modify: `tastile-web/src/middleware.ts` (if needed)

**Step 1: Check middleware**

Read `tastile-web/src/middleware.ts` and verify that `/docs/*` paths are not auth-gated. If they are, add an exclusion.

**Step 2: Verify**

Run: `bun run typecheck`

**Step 3: Commit (if changed)**

```bash
git add tastile-web/src/middleware.ts
git commit -m "fix: allow public access to /docs/api route"
```

---

## Task 5: Verification

**Step 1: Build and test locally**

```bash
cd tastile-web
bun run build
bun run dev
```

Verify:
- `http://localhost:3000/docs/api` renders the Scalar API reference
- `http://localhost:3000/dashboard/account` shows the Tokens tab
- Tokens tab shows the access token with copy functionality
- OpenAPI spec covers all endpoints from router.rs

**Step 2: Run checks**

```bash
bun run check
```

Expected: All lint, typecheck, and tests pass.
