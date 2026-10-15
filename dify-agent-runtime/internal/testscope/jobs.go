package testscope

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	_ "modernc.org/sqlite"
)

type Store interface {
	Insert(Scope) error
	Get(string) (Scope, error)
	List() ([]Scope, error)
	SetPhysical(string, string, int, string) error
	Spend(string, string, int64) error
}
type SQLStore struct{ db *sql.DB }

func NewSQLStore(db *sql.DB) *SQLStore { return &SQLStore{db: db} }

// Migrate runs in the existing runtime SQLite owner's versioned transaction.
func Migrate(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE native_scopes(scope_id TEXT PRIMARY KEY,spec TEXT NOT NULL,token_hash TEXT NOT NULL,status TEXT NOT NULL,pid INTEGER NOT NULL DEFAULT 0,start_time TEXT NOT NULL DEFAULT '',network TEXT NOT NULL DEFAULT '{}'); CREATE TABLE native_scope_budgets(scope_id TEXT NOT NULL,budget_key TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,maximum INTEGER NOT NULL,PRIMARY KEY(scope_id,budget_key)); CREATE TABLE native_scope_identity(scope_id TEXT PRIMARY KEY,generation INTEGER NOT NULL); ALTER TABLE jobs ADD COLUMN native_scope_id TEXT; ALTER TABLE jobs ADD COLUMN native_scope_generation INTEGER;`)
	return err
}
func (s *SQLStore) Insert(scope Scope) error {
	b, err := json.Marshal(scope.Spec)
	if err != nil {
		return err
	}
	network, err := json.Marshal(scope.Network)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO native_scopes(scope_id,spec,token_hash,status,network)VALUES(?,?,?,?,?)`, scope.Spec.ScopeID, string(b), scope.TokenHash, scope.Status, string(network)); err != nil {
		return err
	}
	budgets := map[string]int64{"input": scope.Spec.Limits.InputBytes, "output": scope.Spec.Limits.OutputBytes, "jobs": 64}
	for authority, target := range scope.Network.Targets {
		budgets["network:"+authority] = target.MaxBytes
	}
	for key, maximum := range budgets {
		if _, err = tx.Exec(`INSERT INTO native_scope_budgets(scope_id,budget_key,maximum)VALUES(?,?,?)`, scope.Spec.ScopeID, key, maximum); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *SQLStore) Get(id string) (Scope, error) {
	var scope Scope
	var b, network string
	err := s.db.QueryRow(`SELECT spec,token_hash,status,pid,start_time,network FROM native_scopes WHERE scope_id=?`, id).Scan(&b, &scope.TokenHash, &scope.Status, &scope.PID, &scope.StartTime, &network)
	if err != nil {
		return scope, err
	}
	if err = json.Unmarshal([]byte(network), &scope.Network); err != nil {
		return scope, err
	}
	err = json.Unmarshal([]byte(b), &scope.Spec)
	return scope, err
}
func (s *SQLStore) List() ([]Scope, error) {
	rows, err := s.db.Query(`SELECT spec,token_hash,status,pid,start_time,network FROM native_scopes`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var scopes []Scope
	for rows.Next() {
		var s Scope
		var b, network string
		if err := rows.Scan(&b, &s.TokenHash, &s.Status, &s.PID, &s.StartTime, &network); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(b), &s.Spec); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(network), &s.Network); err != nil {
			return nil, err
		}
		scopes = append(scopes, s)
	}
	return scopes, rows.Err()
}
func (s *SQLStore) SetPhysical(id, status string, pid int, start string) error {
	_, err := s.db.Exec(`UPDATE native_scopes SET status=?,pid=?,start_time=? WHERE scope_id=?`, status, pid, start, id)
	return err
}

func (s *SQLStore) Spend(id, key string, n int64) error {
	if n < 0 {
		return errors.New("invalid budget spend")
	}
	result, err := s.db.Exec(`UPDATE native_scope_budgets SET used=used+? WHERE scope_id=? AND budget_key=? AND used+?<=maximum`, n, id, key, n)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("scope budget exhausted")
	}
	return nil
}

// BudgetWriter reserves bytes durably before emitting them. The reservation is
// conservative on ambiguous writes, and cannot be reset by deleting a spool.
type BudgetWriter struct {
	destination io.Writer
	store       Store
	scope, key  string
	exhausted   func()
}

func NewBudgetWriter(destination io.Writer, store Store, scope, key string, exhausted func()) *BudgetWriter {
	return &BudgetWriter{destination: destination, store: store, scope: scope, key: key, exhausted: exhausted}
}
func (w *BudgetWriter) Write(p []byte) (int, error) {
	if err := w.store.Spend(w.scope, w.key, int64(len(p))); err != nil {
		w.exhausted()
		return 0, err
	}
	return w.destination.Write(p)
}
