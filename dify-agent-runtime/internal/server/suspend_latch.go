package server

import (
	"context"
	"sync"
)

// suspendLatch serializes job admission against a pending workspace
// suspension. admit() tracks jobs that are being started and cancels any
// in-flight save before letting the job proceed; begin() registers the save's
// cancellation while the sandbox is idle; seal() installs the fence once the
// archive is complete so late-arriving RunJob calls fail with a retryable
// error. Invalidation happens under the lock, so an admission wins even when
// the cancellation callback runs after seal() is checked.
//
// Prototype limitation: there is no reopen path once sealed. A failed
// publication or delete can leave the sandbox fenced, while a runtime
// restart loses the in-memory fence. Both cases need recovery before rollout.
type suspendLatch struct {
	mu         sync.Mutex
	starting   int
	cancelSave context.CancelFunc
	fenced     bool
}

// admit registers a job that is about to start. The returned function must
// be called when the job is durably recorded (or abandoned); it is idempotent.
// Admitting also cancels an in-flight suspension save so its seal can never
// succeed afterward.
func (l *suspendLatch) admit() (func(), error) {
	l.mu.Lock()
	if l.fenced {
		l.mu.Unlock()
		return nil, NewServerError(503, "sandbox_suspending", "Job was not started; retry against the resumed sandbox")
	}
	l.starting++
	cancel := l.cancelSave
	l.cancelSave = nil
	l.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return sync.OnceFunc(func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		l.starting--
	}), nil
}

// begin grants a suspension attempt when no admission is in flight, no save
// is already registered, and the supplied activity probe reports the sandbox
// idle. A later admission clears the callback under lock and invokes it
// after releasing the lock.
func (l *suspendLatch) begin(active func() (bool, error), cancel context.CancelFunc) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.fenced || l.starting != 0 || l.cancelSave != nil {
		return NewServerError(409, "suspend_busy", "Sandbox has an active job or suspension")
	}
	busy, err := active()
	if err != nil {
		return err
	}
	if busy {
		return NewServerError(409, "suspend_busy", "Sandbox has an active job or suspension")
	}
	l.cancelSave = cancel
	return nil
}

// seal installs the suspension fence for a completed save. It fails when the
// save was already invalidated by an admission.
func (l *suspendLatch) seal() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cancelSave == nil {
		return false
	}
	l.cancelSave = nil
	l.fenced = true
	return true
}

// endSave clears the registered cancel callback. It runs while the caller
// still holds the outer snapshot gate, so no new save can have replaced the
// callback before this deferred cleanup executes.
func (l *suspendLatch) endSave() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.cancelSave = nil
}
