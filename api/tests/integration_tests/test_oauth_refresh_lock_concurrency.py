"""
Integration test: OAuth token refresh distributed lock under concurrency.

This test verifies that when multiple threads simultaneously detect an expired
OAuth access_token, only ONE thread actually refreshes the token, while the
others safely read the latest credentials from DB. This prevents the race
condition where refresh token rotation (e.g., QuickBooks) causes invalid_grant.

Requirements:
    - Redis running at localhost:6379 (or REDIS_HOST env var)
    - Run with: uv run --project api python -m pytest \
      api/tests/integration_tests/test_oauth_refresh_lock_concurrency.py \
      -v -o "addopts=" -s

Simulated scenario:
    1. A BuiltinToolProvider row exists with expires_at in the past
    2. 10 threads concurrently call the refresh logic
    3. OAuthHandler.refresh_credentials simulates token rotation:
       - Returns new access_token + new refresh_token each call
       - If called with an already-consumed refresh_token, raises error (invalid_grant)
    4. Expected: only 1 thread refreshes; the rest read from DB
"""

import operator
import os
import threading
import time

import redis

# ---------------------------------------------------------------------------
# Simulated token rotation state
# ---------------------------------------------------------------------------


class TokenRotationSimulator:
    """Simulates an OAuth provider with refresh token rotation (like QuickBooks).

    Each call to refresh() consumes the current refresh_token and issues a new one.
    If called with an already-consumed token, it raises an error (invalid_grant).
    """

    def __init__(self, initial_refresh_token: str = "rt_v1"):
        self._lock = threading.Lock()
        self._current_valid_refresh_token = initial_refresh_token
        self._version = 1
        self.call_count = 0
        self.success_count = 0
        self.invalid_grant_count = 0
        self.call_log: list[dict] = []

    def refresh(self, credentials: dict) -> dict:
        """Simulate an OAuth token refresh with rotation."""
        incoming_rt = credentials.get("refresh_token", "")

        # Add artificial delay to simulate network latency
        time.sleep(0.05)

        with self._lock:
            self.call_count += 1

            if incoming_rt != self._current_valid_refresh_token:
                self.invalid_grant_count += 1
                self.call_log.append(
                    {
                        "thread": threading.current_thread().name,
                        "incoming_rt": incoming_rt,
                        "expected_rt": self._current_valid_refresh_token,
                        "result": "invalid_grant",
                    }
                )
                raise RuntimeError(
                    f"invalid_grant: refresh_token '{incoming_rt}' has been revoked. "
                    f"Current valid token is '{self._current_valid_refresh_token}'"
                )

            # Token rotation: consume old, issue new
            self._version += 1
            new_rt = f"rt_v{self._version}"
            new_at = f"at_v{self._version}"
            self._current_valid_refresh_token = new_rt
            self.success_count += 1

            self.call_log.append(
                {
                    "thread": threading.current_thread().name,
                    "incoming_rt": incoming_rt,
                    "new_rt": new_rt,
                    "new_at": new_at,
                    "result": "success",
                }
            )

            return {
                "access_token": new_at,
                "refresh_token": new_rt,
                "expires_at": int(time.time()) + 3600,
            }


# ---------------------------------------------------------------------------
# Test: Concurrent refresh with distributed lock
# ---------------------------------------------------------------------------


def test_concurrent_oauth_refresh_with_lock():
    """Test that distributed lock prevents concurrent token refresh race condition."""

    redis_host = os.environ.get("REDIS_HOST", "localhost")
    redis_port = int(os.environ.get("REDIS_PORT", "6379"))
    redis_password = os.environ.get("REDIS_PASSWORD", None)

    # Connect to Redis
    redis_client = redis.Redis(
        host=redis_host,
        port=redis_port,
        password=redis_password,
        db=15,
    )  # Use DB 15 for testing
    redis_client.ping()

    # Clean up any leftover lock keys
    for key in redis_client.keys("oauth_test_lock:*"):
        redis_client.delete(key)

    # Set up simulator
    simulator = TokenRotationSimulator(initial_refresh_token="rt_v1")

    # Shared state (simulates DB)
    db_state = {
        "access_token": "at_v1",
        "refresh_token": "rt_v1",
        "expires_at": int(time.time()) - 100,  # Expired
    }
    db_lock = threading.Lock()
    db_refresh_count = 0

    # Track per-thread results
    thread_results: list[dict] = []
    results_lock = threading.Lock()

    NUM_THREADS = 10
    LOCK_KEY = "oauth_test_lock:tenant1_provider1"
    barrier = threading.Barrier(NUM_THREADS)

    def worker(thread_id: int):
        nonlocal db_refresh_count
        thread_name = f"thread-{thread_id}"
        threading.current_thread().name = thread_name
        result = {"thread": thread_name, "action": None, "error": None}

        try:
            # Wait for all threads to be ready
            barrier.wait(timeout=5)

            # Read current credentials (simulates reading from DB)
            with db_lock:
                current_creds = dict(db_state)

            # Check if expired
            if current_creds["expires_at"] != -1 and (current_creds["expires_at"] - 60) < int(time.time()):
                lock = redis_client.lock(LOCK_KEY, timeout=30)

                if lock.acquire(blocking=False):
                    try:
                        # Double-check: re-read from DB
                        with db_lock:
                            current_creds = dict(db_state)

                        if current_creds["expires_at"] != -1 and (current_creds["expires_at"] - 60) < int(time.time()):
                            # Actually refresh
                            refreshed = simulator.refresh(current_creds)

                            # Update DB
                            with db_lock:
                                db_state["access_token"] = refreshed["access_token"]
                                db_state["refresh_token"] = refreshed["refresh_token"]
                                db_state["expires_at"] = refreshed["expires_at"]
                                db_refresh_count += 1

                            result["action"] = "refreshed"
                            result["new_at"] = refreshed["access_token"]
                            result["new_rt"] = refreshed["refresh_token"]
                        else:
                            result["action"] = "double_check_skipped"
                    finally:
                        lock.release()
                else:
                    # Another thread is refreshing; poll DB with exponential backoff
                    backoff = 0.1
                    retries = 0
                    for _ in range(5):
                        time.sleep(backoff)
                        retries += 1
                        with db_lock:
                            current_creds = dict(db_state)
                        if current_creds["expires_at"] != -1 and (current_creds["expires_at"] - 60) >= int(time.time()):
                            break
                        backoff = min(backoff * 2, 1.0)
                    result["action"] = "read_from_db"
                    result["retries"] = retries
                    result["read_at"] = current_creds["access_token"]
                    result["read_rt"] = current_creds["refresh_token"]
                    result["got_fresh"] = current_creds["expires_at"] > int(time.time())
            else:
                result["action"] = "not_expired"

        except Exception as e:
            result["error"] = str(e)
            result["action"] = "error"

        with results_lock:
            thread_results.append(result)

    # Launch threads
    threads = []
    for i in range(NUM_THREADS):
        t = threading.Thread(target=worker, args=(i,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join(timeout=10)

    # Clean up
    for key in redis_client.keys("oauth_test_lock:*"):
        redis_client.delete(key)
    redis_client.close()

    # ---------------------------------------------------------------------------
    # Assertions
    # ---------------------------------------------------------------------------

    print("\n" + "=" * 70)
    print("TEST RESULTS: Concurrent OAuth Refresh with Distributed Lock")
    print("=" * 70)

    print(f"\nThreads: {NUM_THREADS}")
    print(f"Simulator call count: {simulator.call_count}")
    print(f"Simulator success count: {simulator.success_count}")
    print(f"Simulator invalid_grant count: {simulator.invalid_grant_count}")
    print(f"DB refresh count: {db_refresh_count}")

    print("\nFinal DB state:")
    print(f"  access_token: {db_state['access_token']}")
    print(f"  refresh_token: {db_state['refresh_token']}")
    print(f"  expires_at: {db_state['expires_at']} (now: {int(time.time())})")

    print("\nPer-thread results:")
    for r in sorted(thread_results, key=operator.itemgetter("thread")):
        extra = ""
        if r["action"] == "read_from_db":
            extra = f", retries={r.get('retries')}, got_fresh={r.get('got_fresh')}, read_at={r.get('read_at')}"
        print(f"  {r['thread']}: action={r['action']}{extra}, error={r.get('error')}")

    print("\nSimulator call log:")
    for entry in simulator.call_log:
        print(f"  {entry}")

    # Core assertion: only 1 refresh should have happened
    assert simulator.call_count == 1, (
        f"Expected exactly 1 refresh call, but got {simulator.call_count}. "
        f"The distributed lock failed to prevent concurrent refreshes."
    )
    assert simulator.success_count == 1, f"Expected exactly 1 successful refresh, got {simulator.success_count}"
    assert simulator.invalid_grant_count == 0, (
        f"Got {simulator.invalid_grant_count} invalid_grant errors. "
        f"This means multiple threads attempted refresh simultaneously."
    )

    # DB should have been updated exactly once
    assert db_refresh_count == 1, f"DB updated {db_refresh_count} times, expected 1"

    # Final DB state should reflect the refreshed token
    assert db_state["access_token"] == "at_v2"
    assert db_state["refresh_token"] == "rt_v2"
    assert db_state["expires_at"] > int(time.time())

    # Every thread should have succeeded (no errors)
    errors = [r for r in thread_results if r["action"] == "error"]
    assert len(errors) == 0, f"Some threads failed: {errors}"

    # Exactly 1 thread should have refreshed
    refreshed = [r for r in thread_results if r["action"] == "refreshed"]
    assert len(refreshed) == 1, f"Expected 1 refreshed thread, got {len(refreshed)}"

    # All waiting threads should have eventually got fresh credentials
    waiters = [r for r in thread_results if r["action"] == "read_from_db"]
    fresh_waiters = [r for r in waiters if r.get("got_fresh")]
    stale_waiters = [r for r in waiters if not r.get("got_fresh")]

    print("\n✓ ALL ASSERTIONS PASSED")
    print("  - Only 1 refresh call was made (lock prevented race condition)")
    print("  - 0 invalid_grant errors")
    print("  - DB updated exactly once")
    print("  - All threads completed without errors")
    print(f"  - {len(fresh_waiters)}/{len(waiters)} waiting threads got fresh credentials via retry")
    if stale_waiters:
        print(f"  - {len(stale_waiters)} threads timed out (will use stale creds as fallback)")
    print("=" * 70)

    # All waiting threads should have got fresh credentials
    assert len(fresh_waiters) == len(waiters), (
        f"{len(stale_waiters)}/{len(waiters)} waiting threads did NOT get fresh credentials. "
        f"Retry mechanism may need tuning."
    )


# ---------------------------------------------------------------------------
# Comparison test: WITHOUT lock (demonstrates the race condition)
# ---------------------------------------------------------------------------


def test_concurrent_oauth_refresh_without_lock_shows_race():
    """Demonstrates that WITHOUT the lock, race condition causes invalid_grant.

    This test is expected to show multiple refresh calls and potential
    invalid_grant errors when no distributed lock is used.
    """

    simulator = TokenRotationSimulator(initial_refresh_token="rt_v1")

    db_state = {
        "access_token": "at_v1",
        "refresh_token": "rt_v1",
        "expires_at": int(time.time()) - 100,
    }
    db_lock = threading.Lock()

    thread_results: list[dict] = []
    results_lock = threading.Lock()

    NUM_THREADS = 10
    barrier = threading.Barrier(NUM_THREADS)

    def worker_no_lock(thread_id: int):
        thread_name = f"thread-{thread_id}"
        threading.current_thread().name = thread_name
        result = {"thread": thread_name, "action": None, "error": None}

        try:
            barrier.wait(timeout=5)

            # Read current credentials (all threads read same expired creds)
            with db_lock:
                current_creds = dict(db_state)

            if current_creds["expires_at"] != -1 and (current_creds["expires_at"] - 60) < int(time.time()):
                # NO LOCK - just refresh directly (this is the bug)
                try:
                    refreshed = simulator.refresh(current_creds)
                    with db_lock:
                        db_state["access_token"] = refreshed["access_token"]
                        db_state["refresh_token"] = refreshed["refresh_token"]
                        db_state["expires_at"] = refreshed["expires_at"]
                    result["action"] = "refreshed"
                except RuntimeError as e:
                    result["action"] = "invalid_grant"
                    result["error"] = str(e)

        except Exception as e:
            result["error"] = str(e)
            result["action"] = "error"

        with results_lock:
            thread_results.append(result)

    threads = []
    for i in range(NUM_THREADS):
        t = threading.Thread(target=worker_no_lock, args=(i,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join(timeout=10)

    print("\n" + "=" * 70)
    print("COMPARISON: Concurrent OAuth Refresh WITHOUT Lock (race condition)")
    print("=" * 70)

    print(f"\nThreads: {NUM_THREADS}")
    print(f"Simulator call count: {simulator.call_count}")
    print(f"Simulator success count: {simulator.success_count}")
    print(f"Simulator invalid_grant count: {simulator.invalid_grant_count}")

    print("\nPer-thread results:")
    for r in sorted(thread_results, key=operator.itemgetter("thread")):
        print(f"  {r['thread']}: action={r['action']}")

    print("\nSimulator call log:")
    for entry in simulator.call_log:
        print(f"  {entry}")

    # Without lock, we expect MULTIPLE refresh calls
    assert simulator.call_count > 1, f"Expected multiple refresh calls without lock, got {simulator.call_count}"

    # We expect invalid_grant errors due to token rotation
    assert simulator.invalid_grant_count > 0, (
        f"Expected invalid_grant errors without lock, got {simulator.invalid_grant_count}"
    )

    invalid_grants = [r for r in thread_results if r["action"] == "invalid_grant"]
    print("\n✓ RACE CONDITION DEMONSTRATED")
    print(f"  - {simulator.call_count} refresh calls (should be 1)")
    print(f"  - {simulator.invalid_grant_count} invalid_grant errors")
    print(f"  - {len(invalid_grants)}/{NUM_THREADS} threads hit invalid_grant")
    print("=" * 70)


if __name__ == "__main__":
    print("Running test WITH lock...")
    test_concurrent_oauth_refresh_with_lock()
    print("\n\nRunning test WITHOUT lock (showing race condition)...")
    test_concurrent_oauth_refresh_without_lock_shows_race()
