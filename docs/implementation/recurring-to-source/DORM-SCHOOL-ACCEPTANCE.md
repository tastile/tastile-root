# Dorm and School Acceptance Matrix

This matrix is an executable acceptance backlog for the user-provided dorm,
school, workflow, and routine scenarios. A row is **not complete** until its
public-API fixture runs against PostgreSQL and records SourceTile → Occurrence
→ Placement → Execution/Decision evidence. Compile-only evidence is listed as
partial or unverified.

| ID | Scenario | Canonical representation required | Current state | Required proof |
| --- | --- | --- | --- | --- |
| DS-01 | 2学期 (6/10–8/10) label applies timetable | Label placement/window plus Source applicability | Partial | API fixture creates label and shows only in-range course occurrences |
| DS-02 | 夏季休暇 / テスト期間 labels | Label placement/window plus overlapping conditions | Partial | API fixture proves inclusion/exclusion and revision history |
| DS-03 | Mon–Fri normal class slots | Source recurring generation, fixed temporal policy | Partial | JST weekly materialization of all four slot ranges |
| DS-04 | Wednesday afternoon slot shape | Multiple Source schedules for one course Plan | Partial | Wednesday spans differ from normal weekdays |
| DS-05 | PJ learning Mon/Tue/Wed/Thu multiple slots | Multiple Sources linked to one Plan/subject | Partial | one course read model exposes every required occurrence |
| DS-06 | Date-specific special timetable | One-time/date-range Sources for the special date plus a normal-Source exclusion/reflow rule | Missing | 7/16 and 7/22 materialize the date Sources while the normally applicable Thursday/Wednesday Sources are excluded with history retained |
| DS-07 | Holiday / no school / TBD makeup days | Typed calendar fact/override and applicability | Partial | 7/20 emits none; 8/6–8/10 remain explicitly unscheduled |
| DS-08 | Dorm fixed sleep, meals, roll calls, lights-out | Fixed temporal policy on Sources | Partial | non-movable spans are preserved through reflow |
| DS-09 | いど端底力 21:00–22:40 + 5-minute preparation | Fixed parent Source plus temporal offset dependency | Missing | parent and preparation have independent source/occurrence identities |
| DS-10 | 15/5/30/5/45 nested phases | Ordered temporal dependency plus INSIDE containment | Missing | all phase placements are contained and ordered |
| DS-11 | Reflection task after the session | Completion task/temporal dependency | Partial | task is visible after final phase through public read API |
| DS-12 | Default gap break workflow | Source-owned Gap Flow materialization | Missing | Gap Flow emits canonical identity-bearing break placements |
| DS-13 | Workflow interruption resets sequence | Interrupt/reset policy over dependency state | Missing | interrupt resets next phase to work-1 without corrupting execution history |
| DS-14 | Break task such as music/game | Plan task on break placement | Partial | task is present on the emitted break execution basis |
| DS-15 | Duolingo → Mochitan → LinkedIn Games | Ordered task/temporal dependency | Missing | completion gates the next item via public API |
| DS-16 | Sleep debt → nap / coffee before all-nighter | Metric/Decision/temporal dependency | Missing | facts/metrics produce a decision with retained history |
| DS-17 | Laundry wash → dry → collect, 3+ day cadence | Ordered temporal dependency and interval condition | Missing | sequential occurrences obey required durations and interval |
| DS-18 | Saturday AtCoder inside session | Calendar condition + containment/override | Partial | Saturday replaces the session content without a special-case enum |

## Global gates

- Every DS fixture uses authenticated public HTTP only; it must not insert
  fixtures through SQL.
- The fixture records JST input and validates UTC persisted spans explicitly.
- Owner A cannot read or mutate Owner B's sources, occurrences, placements,
  executions, labels, or decisions.
- A replayed idempotency key returns the original IDs; concurrent execution
  start has one defined winner.
- Web and Android run the same fixture contract after the Core API pass.
- WSLC retains PostgreSQL, API, worker, and test evidence artifacts.
