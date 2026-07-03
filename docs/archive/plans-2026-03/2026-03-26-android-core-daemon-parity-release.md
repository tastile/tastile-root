# Android Core-Daemon Parity + Production Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `tastile-android` fully core-authoritative (same behavior contract as desktop/web), sync through the same Supabase project, and ship to Google Play production.

**Architecture:** Embed a mobile daemon runtime layer in Android that delegates all execution logic to `tastile-core` (commands, prompt decisions, timeline, sync), then make Android UI a thin projection + command sender. Replace direct `tiles`/`events` table writes from Android with core command APIs. Keep auth/session/sync parity with desktop/web and drive notifications from core prompt state changes.

**Tech Stack:** Kotlin + Jetpack Compose + Hilt, Rust (`tastile-core`, `tastile-api`, `tastile-sync`), JNI/FFI bridge, Supabase Auth/DB/Realtime, Gradle + cargo-ndk, Play Console release pipeline.

---

### Task 1: Freeze architecture contract and baseline tests

**Files:**
- Modify: `tastile-android/app/build.gradle.kts`
- Create: `tastile-android/app/src/test/java/app/tastile/android/core/CoreParityContractTest.kt`
- Create: `tastile-android/app/src/test/java/app/tastile/android/ui/prompt/PromptStateProjectionTest.kt`
- Modify: `tastile-android/README.md`

**Step 1: Write the failing test**

```kotlin
@Test
fun tileLifecycleMustNotMutateSupabaseDirectly() {
    val repo = TileRepository(/* fake direct client */)
    assertFailsWith<UnsupportedOperationException> {
        runTest { repo.startTile("tile-1") }
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.core.CoreParityContractTest"`

Expected: FAIL because repository still mutates Supabase directly.

**Step 3: Write minimal implementation**

- Add test dependencies (`junit`, `kotlinx-coroutines-test`, `mockk`) in `app/build.gradle.kts`.
- Add explicit guard in repository layer that old direct mutation path is unsupported while migrating.

**Step 4: Run test to verify it passes**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.core.CoreParityContractTest"`

Expected: PASS.

**Step 5: Commit**

```bash
git add tastile-android/app/build.gradle.kts tastile-android/app/src/test/java/app/tastile/android/core/CoreParityContractTest.kt tastile-android/app/src/test/java/app/tastile/android/ui/prompt/PromptStateProjectionTest.kt tastile-android/README.md
git commit -m "test(android): add parity contract baseline tests"
```

---

### Task 2: Add Rust mobile daemon FFI surface (core-authoritative command/snapshot/sync)

**Files:**
- Create: `tastile-core/crates/tastile-mobile-ffi/Cargo.toml`
- Create: `tastile-core/crates/tastile-mobile-ffi/src/lib.rs`
- Modify: `tastile-core/Cargo.toml`
- Modify: `tastile-core/scripts/build-android.sh`
- Test: `tastile-core/crates/tastile-mobile-ffi/tests/ffi_contract_test.rs`

**Step 1: Write the failing test**

```rust
#[test]
fn execute_command_returns_snapshot_json() {
    let handle = ffi_init_test_runtime();
    let res = ffi_execute_command_json(handle, r#"{"type":"create_tile","payload":{"title":"A"}}"#);
    assert!(res.contains("\"state\""));
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-core && cargo test -p tastile-mobile-ffi`

Expected: FAIL because crate/functions do not exist.

**Step 3: Write minimal implementation**

- Implement `cdylib` crate exposing C ABI:
  - `tastile_mobile_init`
  - `tastile_mobile_set_auth_session_json`
  - `tastile_mobile_execute_command_json`
  - `tastile_mobile_read_snapshot_json`
  - `tastile_mobile_sync_now_json`
  - `tastile_mobile_free_string`
- Use existing `tastile-api` + `tastile-sync` internals, not UI logic.
- Return structured JSON with explicit error fields.

**Step 4: Run test to verify it passes**

Run: `cd tastile-core && cargo test -p tastile-mobile-ffi`

Expected: PASS.

**Step 5: Commit**

```bash
git add tastile-core/Cargo.toml tastile-core/scripts/build-android.sh tastile-core/crates/tastile-mobile-ffi
git commit -m "feat(core): add mobile ffi command and snapshot bridge"
```

---

### Task 3: Wire Android JNI bridge to mobile FFI

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/core/TastileCoreBridge.kt`
- Create: `tastile-android/app/src/main/java/app/tastile/android/core/CoreDtos.kt`
- Create: `tastile-android/app/src/main/java/app/tastile/android/core/CoreRuntimeService.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/di/AppModule.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/TastileApp.kt`
- Test: `tastile-android/app/src/test/java/app/tastile/android/core/TastileCoreBridgeTest.kt`

**Step 1: Write the failing test**

```kotlin
@Test
fun executeCommandDelegatesToNativeAndParsesSnapshot() = runTest {
    val bridge = FakeBridge("""{"accepted":true,"state":{"execution":{"active_tile_id":"t1"}}}""")
    val service = CoreRuntimeService(bridge)
    val result = service.execute(CreateTileCommand("X"))
    assertEquals("t1", result.state.execution.activeTileId)
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.core.TastileCoreBridgeTest"`

Expected: FAIL because bridge/service not implemented.

**Step 3: Write minimal implementation**

- Load native library from `jniLibs`.
- Implement safe JNI wrappers (non-null handle checks, explicit error propagation).
- Parse JSON into strongly typed Kotlin DTOs used by ViewModels.

**Step 4: Run test to verify it passes**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.core.TastileCoreBridgeTest"`

Expected: PASS.

**Step 5: Commit**

```bash
git add tastile-android/app/src/main/java/app/tastile/android/core tastile-android/app/src/main/java/app/tastile/android/di/AppModule.kt tastile-android/app/src/main/java/app/tastile/android/TastileApp.kt tastile-android/app/src/test/java/app/tastile/android/core/TastileCoreBridgeTest.kt
git commit -m "feat(android): connect app to mobile core ffi bridge"
```

---

### Task 4: Replace direct tile/event mutations with core commands

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/data/repository/TileRepository.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/data/repository/EventRepository.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/now/NowViewModel.kt`
- Test: `tastile-android/app/src/test/java/app/tastile/android/data/repository/TileRepositoryCoreCommandTest.kt`

**Step 1: Write the failing test**

```kotlin
@Test
fun startTileUsesCoreCommandNotDirectSupabaseUpdate() = runTest {
    val service = RecordingCoreRuntimeService()
    val repo = TileRepository(coreRuntimeService = service, /* no direct table writer */)
    repo.startTile("tile-123")
    assertEquals("start_tile", service.lastCommandType)
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.data.repository.TileRepositoryCoreCommandTest"`

Expected: FAIL because repository still calls `.from("tiles").update`.

**Step 3: Write minimal implementation**

- Route `create/start/complete/pause/delete` to `CoreRuntimeService.execute(...)`.
- Remove direct writes to `tiles` table for execution state.
- Keep read-side projections from core snapshot output.

**Step 4: Run test to verify it passes**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.data.repository.TileRepositoryCoreCommandTest"`

Expected: PASS.

**Step 5: Commit**

```bash
git add tastile-android/app/src/main/java/app/tastile/android/data/repository/TileRepository.kt tastile-android/app/src/main/java/app/tastile/android/data/repository/EventRepository.kt tastile-android/app/src/main/java/app/tastile/android/ui/now/NowViewModel.kt tastile-android/app/src/test/java/app/tastile/android/data/repository/TileRepositoryCoreCommandTest.kt
git commit -m "refactor(android): route tile lifecycle through core commands"
```

---

### Task 5: Make prompt/countdown/timeline projection-only (no UI-side calculations)

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/prompt/PromptViewModel.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/prompt/PromptScreen.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/now/NowScreen.kt`
- Test: `tastile-android/app/src/test/java/app/tastile/android/ui/prompt/PromptViewModelProjectionTest.kt`

**Step 1: Write the failing test**

```kotlin
@Test
fun promptStateComesFromCoreSnapshotNotLocalTimer() = runTest {
    val vm = PromptViewModel(fakeRepoWithSnapshot(promptSeverity = "high", remainingSec = 300))
    vm.refresh()
    assertEquals(5, vm.remainingMinutes.value)
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.ui.prompt.PromptViewModelProjectionTest"`

Expected: FAIL because ViewModel currently uses local `delay(60000)` and hardcoded threshold.

**Step 3: Write minimal implementation**

- Remove `PROMPT_THRESHOLD_MINUTES` and minute loop.
- Read prompt/timeline/countdown from core snapshot fields.
- Prompt actions (`continue`, `take_break`, `complete`) become core commands only.

**Step 4: Run test to verify it passes**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.ui.prompt.PromptViewModelProjectionTest"`

Expected: PASS.

**Step 5: Commit**

```bash
git add tastile-android/app/src/main/java/app/tastile/android/ui/prompt/PromptViewModel.kt tastile-android/app/src/main/java/app/tastile/android/ui/prompt/PromptScreen.kt tastile-android/app/src/main/java/app/tastile/android/ui/now/NowScreen.kt tastile-android/app/src/test/java/app/tastile/android/ui/prompt/PromptViewModelProjectionTest.kt
git commit -m "refactor(android): make prompt and countdown projection-only"
```

---

### Task 6: Auth + sync parity (same Supabase backend, cross-device coherence)

**Files:**
- Modify: `tastile-android/app/src/main/java/app/tastile/android/data/repository/AuthRepository.kt`
- Create: `tastile-android/app/src/main/java/app/tastile/android/sync/SyncCoordinator.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/MainActivity.kt`
- Modify: `tastile-android/app/src/main/AndroidManifest.xml`
- Test: `tastile-android/app/src/test/java/app/tastile/android/sync/SyncCoordinatorTest.kt`

**Step 1: Write the failing test**

```kotlin
@Test
fun authenticatedSessionTriggersCoreSyncAndSnapshotRefresh() = runTest {
    val sync = RecordingSyncCoordinator()
    sync.onSessionAvailable("token-1")
    assertTrue(sync.syncTriggered)
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.sync.SyncCoordinatorTest"`

Expected: FAIL because sync coordinator does not exist.

**Step 3: Write minimal implementation**

- On auth success, pass session/token into core runtime.
- Trigger immediate `sync_now`.
- Start periodic/background sync + foreground refresh hooks.
- Ensure project endpoint is `cltymfzdhdnebazmayxd`.

**Step 4: Run test to verify it passes**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.sync.SyncCoordinatorTest"`

Expected: PASS.

**Step 5: Commit**

```bash
git add tastile-android/app/src/main/java/app/tastile/android/data/repository/AuthRepository.kt tastile-android/app/src/main/java/app/tastile/android/sync/SyncCoordinator.kt tastile-android/app/src/main/java/app/tastile/android/MainActivity.kt tastile-android/app/src/main/AndroidManifest.xml tastile-android/app/src/test/java/app/tastile/android/sync/SyncCoordinatorTest.kt
git commit -m "feat(android): add auth-driven core sync parity flow"
```

---

### Task 7: Cross-device notifications and prompt ingestion

**Files:**
- Create: `tastile-android/app/src/main/java/app/tastile/android/notifications/PromptNotificationManager.kt`
- Create: `tastile-android/app/src/main/java/app/tastile/android/notifications/PromptPushReceiver.kt`
- Modify: `tastile-android/app/src/main/java/app/tastile/android/ui/prompt/PromptViewModel.kt`
- Modify: `tastile-android/app/src/main/AndroidManifest.xml`
- Test: `tastile-android/app/src/test/java/app/tastile/android/notifications/PromptNotificationManagerTest.kt`

**Step 1: Write the failing test**

```kotlin
@Test
fun highSeverityPromptPublishesNotification() {
    val manager = PromptNotificationManager(fakeContext)
    manager.onPromptUpdate(severity = "high", tileTitle = "Focus")
    assertTrue(manager.lastNotificationPosted)
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.notifications.PromptNotificationManagerTest"`

Expected: FAIL because manager/receiver do not exist.

**Step 3: Write minimal implementation**

- Emit local notification on core prompt state transition.
- Hook notification action buttons to prompt commands.
- Keep prompt canonical state in core snapshot; notification is only transport/UI.

**Step 4: Run test to verify it passes**

Run: `cd tastile-android && .\gradlew testDebugUnitTest --tests "app.tastile.android.notifications.PromptNotificationManagerTest"`

Expected: PASS.

**Step 5: Commit**

```bash
git add tastile-android/app/src/main/java/app/tastile/android/notifications tastile-android/app/src/main/AndroidManifest.xml tastile-android/app/src/main/java/app/tastile/android/ui/prompt/PromptViewModel.kt tastile-android/app/src/test/java/app/tastile/android/notifications/PromptNotificationManagerTest.kt
git commit -m "feat(android): add core-driven prompt notifications"
```

---

### Task 8: Integration tests for Android↔Desktop sync parity

**Files:**
- Create: `tastile-android/app/src/androidTest/java/app/tastile/android/SyncParityInstrumentedTest.kt`
- Modify: `tastile-android/README.md`
- Modify: `tastile-android/docs/release-plan.md`

**Step 1: Write the failing test**

```kotlin
@Test
fun tileStartedOnDesktopAppearsOnAndroidAsRunning() {
    // Arrange: seed shared Supabase with desktop-origin event
    // Assert: Android snapshot shows same active tile id + remaining time
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-android && .\gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=app.tastile.android.SyncParityInstrumentedTest`

Expected: FAIL before parity wiring is complete.

**Step 3: Write minimal implementation**

- Add parity test harness fixtures and deterministic test user/project.
- Validate create/start/complete/break/prompt actions from either device reflect on the other.

**Step 4: Run test to verify it passes**

Run: `cd tastile-android && .\gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=app.tastile.android.SyncParityInstrumentedTest`

Expected: PASS.

**Step 5: Commit**

```bash
git add tastile-android/app/src/androidTest/java/app/tastile/android/SyncParityInstrumentedTest.kt tastile-android/README.md tastile-android/docs/release-plan.md
git commit -m "test(android): add desktop parity instrumented sync tests"
```

---

### Task 9: Production release hardening and Play deployment

**Files:**
- Modify: `tastile-android/app/build.gradle.kts`
- Modify: `tastile-android/app/proguard-rules.pro`
- Modify: `tastile-android/gradle.properties`
- Modify: `tastile-android/docs/release-plan.md`
- Create: `tastile-android/docs/play-production-checklist.md`

**Step 1: Write the failing test**

```kotlin
@Test
fun releaseBuildUsesNonEmptySupabaseConfig() {
    assertTrue(BuildConfig.SUPABASE_URL.isNotBlank())
    assertTrue(BuildConfig.SUPABASE_ANON_KEY.isNotBlank())
}
```

**Step 2: Run test to verify it fails**

Run: `cd tastile-android && .\gradlew testReleaseUnitTest --tests "app.tastile.android.ReleaseConfigTest"`

Expected: FAIL if release config is empty/missing.

**Step 3: Write minimal implementation**

- Finalize minify/keep rules for Supabase/Ktor/serialization.
- Add explicit release config checks.
- Produce signed AAB and upload to Play production with staged rollout and rollback notes.

**Step 4: Run test/build to verify**

Run:
- `cd tastile-android && .\gradlew testReleaseUnitTest`
- `cd tastile-android && .\gradlew bundleRelease`

Expected: PASS + `app-release.aab` generated.

**Step 5: Commit**

```bash
git add tastile-android/app/build.gradle.kts tastile-android/app/proguard-rules.pro tastile-android/gradle.properties tastile-android/docs/release-plan.md tastile-android/docs/play-production-checklist.md
git commit -m "chore(android): harden production build and play release checklist"
```

---

### Task 10: Full regression gate before release

**Files:**
- Modify: `docs/plans/2026-03-26-android-core-daemon-parity-release.md` (checklist updates only)

**Step 1: Run full core tests**

Run: `cd tastile-core && cargo test`

Expected: PASS.

**Step 2: Run Android unit tests**

Run: `cd tastile-android && .\gradlew testDebugUnitTest testReleaseUnitTest`

Expected: PASS.

**Step 3: Run Android instrumentation tests**

Run: `cd tastile-android && .\gradlew connectedDebugAndroidTest`

Expected: PASS.

**Step 4: Build release artifacts**

Run: `cd tastile-android && .\gradlew assembleRelease bundleRelease`

Expected: PASS with signed outputs.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-26-android-core-daemon-parity-release.md
git commit -m "docs(android): mark parity and release verification complete"
```

---

## Notes and constraints

- Do not reintroduce direct execution-state writes to Supabase from Android UI/repositories.
- Absolute time/countdown/prompt decisions must come from core snapshot fields only.
- Keep command payloads compatible with existing desktop/web command contract shape.
- Same Supabase project (`cltymfzdhdnebazmayxd`) must be used for Android/Desktop/Web parity tests.
- For production push handling, notification transport may vary, but authoritative prompt state remains core-origin.

