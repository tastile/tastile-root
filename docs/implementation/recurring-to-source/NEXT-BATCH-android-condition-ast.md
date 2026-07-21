# Next Batch: Android Condition AST Polymorphic Typed Mirror

This document captures the **concrete, ready-to-execute** plan for the next batch
that must complete the Android typed DTO criterion in `/goal`. The current
state at HEAD `f3ca8ed` (tastile-root) / `82ba775` (tastile-android):

- 5 of 6 top-level plan fields are typed (commit `82ba775`).
- `SchedulePlanDefinitionPayloadTyped.completion.root` still uses
  `JsonElement` because the recursive Condition AST is an externally-tagged
  union (4 Condition variants * 10 Term variants * 5 leaf sub-unions).

## What is needed

Mirror the recursive v1/05 Condition AST + Term AST in Kotlin with **wire-shape
parity** to what Core emits, using a custom `KSerializer`. Replace the
`JsonElement` fallback in `SchedulePlanDefinitionPayloadTyped.completion.root`
with the typed sealed class.

### Wire shape recap (externally tagged)

```json
{"All": [...]}                     // Condition::All(Vec<ConditionRef>)
{"Any": [...]}                     // Condition::Any(Vec<ConditionRef>)
{"Not": <ConditionRef>}            // Condition::Not(Box<ConditionRef>)
{"Term": {"Calendar": {...}}}       // Condition::Term -> TermSchema
```

For Term:
```json
{"Calendar": {...}}                // Term::Calendar with CalendarTerm fields
{"Moment": {"point": 1, "target": {"Context": 0}, ...}}
{"Requirement": {"time_requirement": "uuid", "state": "Met"}}
... 8 more Term variants and MomentTarget/MomentComparison/FactComparison/
MetricComparison/LifeTarget sub-enums
```

### The wire-shape problem with kotlinx-serialization defaults

`kotlinx-serialization`'s `JsonContentPolymorphicSerializer` and tagged
sealed-class serialisers wrap variants as `{"type":"VariantName", "field":...}`
or `{"field":...}` -- they do not produce externally-tagged JSON.

### Successful approach taken this session (in `ConditionAstMirror.kt`)

A custom `KSerializer<T>` for each polymorphic level (Condition, Term,
MomentTarget, MomentComparison, FactComparison, MetricComparison,
LifeTarget) that:

1. On `serialize`: calls `encoder.beginStructure(descriptor)` to obtain a
   `CompositeEncoder`, then writes the variant tag as the first element
   (`encodeStringElement(descriptor, 0, key)`), then writes the variant
   payload as the second element using `encodeSerializableElement(descriptor, 1, JsonElement.serializer(), payload)`.
2. On `deserialize`: mirrors the read with `decoder.beginStructure(descriptor)`
   plus a `loop@ while (true) { when (decodeElementIndex(...)) ... }` to
   consume each element then break on `DECODE_DONE`.

Each concrete variant is a `@Serializable data class` (e.g. `ConditionAll`,
`TermCalendar`). When the polymorphic serializer is done, it invokes the
specific variant serializer with the payload, producing exactly the
externally-tagged JSON.

### Required files for the next batch

1. `tastile-android/app/src/main/java/app/tastile/android/data/api/ConditionAstMirror.kt`
   - Define each polymorphic data class (`ConditionAll`, `ConditionAny`,
     `ConditionNot`, `ConditionTerm`, plus the `Term.*` variants and the
     leaf sub-enums).
   - Define each polymorphic `KSerializer` following the pattern described
     above.
   - Leave one `KSerializer` per polymorphic level (no manual recursion --
     each level delegates to the next via plain serialization).

2. `tastile-android/app/src/main/java/app/tastile/android/data/api/SchedulePlanAst.kt`
   - Switch `CompletionSchema.root` from `JsonElement` to `ConditionSchema`.
   - Switch the other JsonElement fields that are clearly typed in Core:
     `MetricDefSchema.expression` (ScalarExpression), `DecisionDefSchema.candidates.effects`
     (CandidateEffect), `CompletionSchema.tasks` (TaskDefinition), and the
     `FeedbackMappingSchema.value` (ChangeValue) -- all of which are
     externally-tagged unions and can mirror with the same custom-serializer
     pattern as the Condition AST.

3. `tastile-android/app/src/test/java/app/tastile/android/data/api/SourceTileApiContractTest.kt`
   - Update the `sourceWritePayload()` helper to construct a typed
     `ConditionSchema` (e.g. `ConditionAny(emptyList())`).

4. New test file
   `tastile-android/app/src/test/java/app/tastile/android/data/api/ConditionAstWireShapeTest.kt`
   - Construct each variant (`ConditionAll`, `ConditionAny`, `ConditionNot`,
     `TermCalendar`, `TermMoment(At)`, `TermRelation`, `TermGap`,
     `TermRequirement`, `TermTask`, `TermFact(Equal)`, `TermMetric(Equal)`,
     `TermFeedback`, `TermLife(Tile)`).
   - For each, assert the JSON it serialises to matches the expected
     externally-tagged form byte-for-byte (matching what Core emits per the
     OpenAPI schema).
   - Round-trip: serialise -> deserialise -> assert equality.

### Programming-in-the-small checklist

- Use the `kotlinx-serialization` StructureEncoder API correctly; read all
  elements in order with `loop@ while (true) { when (decodeElementIndex(...)) { DECODE_DONE -> break@loop } }`.
- Avoid declaring both `private val descriptor` and `override val descriptor`
  in the same object (this caused an ambiguity in the first draft of this
  batch). The pattern is one initialiser expression for `override val descriptor`.
- For `JsonElement` deserialisation, use `JsonElement.serializer()` (the
  built-in serializer for the union of JsonElement values) -- it is
  available via `kotlinx.serialization.json.JsonElement.serializer()`.
- For numeric type coercion from `JsonPrimitive`, either import
  `kotlinx.serialization.json.jsonPrimitive` or cast via
  `(payload as JsonPrimitive).int` / `.long` / `.content`.
- Use `@SerialName("VariantName")` on each sealed-class data subclass so
  `kxsx-serialization` can map between Kotlin class names and JSON keys.
- Wrap each polymorphic data class inside a `ConditionRef` / `TermRef` /
  `MomentRef` wrapper that holds the inner sealed type; the recursive
  references go through `ConditionRef.inner: ConditionSchema` etc., and
  each ref has its own `KSerializer` to break the cycle.

### Verification gate

Once the next batch lands:

1. `gradle :app:testDebugUnitTest --rerun-tasks` -> 408 of 408 PASS.
2. `SourceTileApiContractTest.source_tile_create_and_update_share_the_canonical_payload_shape`
   -> PASS using the typed `ConditionSchema.Any(emptyList())` constructor.
3. `ConditionAstWireShapeTest` -> PASS for every variant.
4. Append `EV-WSLC-20260721-12` (or higher) to
   `docs/implementation/recurring-to-source/EVIDENCE.md`.

### Why this is not yet shipped in `82ba775`

A first `JsonContentPolymorphicSerializer` attempt at `82ba775+`
(refer to session notes) produced `{"value":[...]}` instead of `{"All":[...]}`,
because the polymorphic dispatch writes the variant payload via its
`@Serializable` serializer (which puts `items` under the data class's own
field name) without wrapping it in the variant key. The custom
`KSerializer` approach in this document has been prototyped in
`ConditionAstMirror.kt` but landed with several compile errors due to
descriptor-declaration duplication -- the pattern in this doc has been
corrected (one `override val descriptor` per object) and is ready to ship
in a clean session.

### Estimated effort

~400 LoC of new Kotlin, ~150 LoC of new tests, one round of gradle
build/test/lint. Likely one focused session of work.
