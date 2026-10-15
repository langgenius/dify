package testscope

import (
	"bytes"
	"database/sql"
	_ "modernc.org/sqlite"
	"path/filepath"
	"testing"
)

func TestScopeCatalogImmutableAndSurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("CREATE TABLE jobs(job_id TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err = Migrate(tx); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	store := NewSQLStore(db)
	scope := Scope{Spec: validSpec(), TokenHash: HashToken("secret"), Status: "creating"}
	if err = store.Insert(scope); err != nil {
		t.Fatal(err)
	}
	changed := scope
	changed.Spec.Generation++
	if store.Insert(changed) == nil {
		t.Fatal("overwrote immutable scope")
	}
	_ = db.Close()
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	got, err := NewSQLStore(db).Get(scope.Spec.ScopeID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Spec.Generation != scope.Spec.Generation || got.TokenHash != scope.TokenHash {
		t.Fatal("lost durable identity")
	}
}
func TestDurableBudgetsCannotBeResetOrOverspent(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if _, err = db.Exec("CREATE TABLE jobs(job_id TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	tx, _ := db.Begin()
	if err = Migrate(tx); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	store := NewSQLStore(db)
	s := Scope{Spec: validSpec(), Status: "creating"}
	if err = store.Insert(s); err != nil {
		t.Fatal(err)
	}
	if err = store.Spend(s.Spec.ScopeID, "input", s.Spec.Limits.InputBytes); err != nil {
		t.Fatal(err)
	}
	if store.Spend(s.Spec.ScopeID, "input", 1) == nil {
		t.Fatal("overspent finite scope input")
	}
	if store.Spend(s.Spec.ScopeID, "input", -1) == nil {
		t.Fatal("negative spend reset budget")
	}
}
func TestOutputBudgetSurvivesWriterReopenAndSpoolDeletion(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "shellctl.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if _, err = db.Exec("CREATE TABLE jobs(job_id TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	tx, _ := db.Begin()
	if err = Migrate(tx); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	spec := validSpec()
	spec.Limits.OutputBytes = 4096
	store := NewSQLStore(db)
	if err = store.Insert(Scope{Spec: spec, Status: "ready"}); err != nil {
		t.Fatal(err)
	}
	var first, second bytes.Buffer
	writer := NewBudgetWriter(&first, store, spec.ScopeID, "output", func() {})
	if _, err = writer.Write(make([]byte, 4096)); err != nil {
		t.Fatal(err)
	}
	// New stream/writer cannot reset the durable scope budget.
	reopened := NewBudgetWriter(&second, NewSQLStore(db), spec.ScopeID, "output", func() {})
	if _, err = reopened.Write([]byte("x")); err == nil || second.Len() != 0 {
		t.Fatal("new spool bypassed durable output budget")
	}
}

func TestJobAdmissionBudgetSurvivesCatalogRowDeletion(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if _, err = db.Exec("CREATE TABLE jobs(job_id TEXT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	tx, _ := db.Begin()
	if err = Migrate(tx); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	store := NewSQLStore(db)
	spec := validSpec()
	if err = store.Insert(Scope{Spec: spec}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 64; i++ {
		if err = store.Spend(spec.ScopeID, "jobs", 1); err != nil {
			t.Fatalf("admission %d: %v", i, err)
		}
	}
	if _, err = db.Exec("DELETE FROM jobs"); err != nil {
		t.Fatal(err)
	}
	if err = store.Spend(spec.ScopeID, "jobs", 1); err == nil {
		t.Fatal("deleted jobs reset lifetime admission capacity")
	}
}
