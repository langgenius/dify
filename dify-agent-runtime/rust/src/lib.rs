//! Rust implementation of the shellctl runtime.
//!
//! The public HTTP contract intentionally mirrors the Go runtime so the
//! Python agent sandbox can switch implementations without a protocol change.

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{SecondsFormat, Utc};
use rand::RngCore;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::{OsStr, OsString},
    fs::{self, File},
    io::{self, Read, Write},
    os::unix::process::CommandExt,
    path::{Path as FsPath, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

pub const DEFAULT_LISTEN: &str = "127.0.0.1:8765";
const DEFAULT_OUTPUT_LIMIT: usize = 16 * 1024;
const MAX_OUTPUT_LIMIT: usize = 512 * 1024;
const DEFAULT_IDLE_FLUSH: f64 = 0.5;
const POLL_INTERVAL: Duration = Duration::from_millis(50);
// Completion artifacts are local files and are cheap to inspect. Poll them
// more frequently than the tmux liveness fallback so short jobs do not pay a
// full 50 ms scheduling quantum while still limiting tmux subprocess churn.
const OUTPUT_WAIT_INTERVAL: Duration = Duration::from_millis(5);
// These only apply while a job is being started, before user code can run.
const PIPE_READY_POLL_INTERVAL: Duration = Duration::from_millis(5);
const START_GATE_POLL_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Debug, Clone)]
pub struct Config {
    pub listen: String,
    pub auth_token: String,
    pub state_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub default_cwd: PathBuf,
    pub default_timeout: Duration,
    pub max_wait_timeout: Duration,
    pub gc_retention: Duration,
    pub gc_interval: Duration,
    pub pipe_monitor_interval: Duration,
    pub pipe_ready_timeout: Duration,
    pub sqlite_busy_timeout_ms: u64,
    pub terminal_cols: i32,
    pub terminal_rows: i32,
    pub default_output_limit: usize,
    pub max_output_limit: usize,
    pub terminate_grace: f64,
}

impl Default for Config {
    fn default() -> Self {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"));
        let state_dir = if let Some(xdg) = env::var_os("XDG_DATA_HOME") {
            PathBuf::from(xdg).join("shellctl")
        } else {
            home.join(".local/share/shellctl")
        };
        Self {
            listen: DEFAULT_LISTEN.into(),
            auth_token: env::var("SHELLCTL_AUTH_TOKEN").unwrap_or_default(),
            runtime_dir: state_dir.join("runtime"),
            state_dir,
            default_cwd: home,
            default_timeout: Duration::from_secs(30),
            max_wait_timeout: Duration::from_secs(600),
            gc_retention: Duration::from_secs(300),
            gc_interval: Duration::from_secs(60),
            pipe_monitor_interval: Duration::from_secs(1),
            pipe_ready_timeout: Duration::from_secs(10),
            sqlite_busy_timeout_ms: 5000,
            terminal_cols: 200,
            terminal_rows: 50,
            default_output_limit: DEFAULT_OUTPUT_LIMIT,
            max_output_limit: MAX_OUTPUT_LIMIT,
            terminate_grace: 10.0,
        }
    }
}

impl Config {
    pub fn jobs_dir(&self) -> PathBuf {
        self.state_dir.join("jobs")
    }
    pub fn db_path(&self) -> PathBuf {
        self.state_dir.join("shellctl.db")
    }
    pub fn tmux_socket(&self) -> PathBuf {
        self.runtime_dir.join("tmux.sock")
    }
    pub fn runner_path(&self) -> PathBuf {
        self.runtime_dir.join("bin/shellctl-runner")
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Created,
    Starting,
    Running,
    Exited,
    Terminated,
    Failed,
    Lost,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Exited => "exited",
            Self::Terminated => "terminated",
            Self::Failed => "failed",
            Self::Lost => "lost",
        }
    }
    fn terminal(self) -> bool {
        matches!(
            self,
            Self::Exited | Self::Terminated | Self::Failed | Self::Lost
        )
    }
}

impl TryFrom<&str> for Status {
    type Error = RuntimeError;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "created" => Ok(Self::Created),
            "starting" => Ok(Self::Starting),
            "running" => Ok(Self::Running),
            "exited" => Ok(Self::Exited),
            "terminated" => Ok(Self::Terminated),
            "failed" => Ok(Self::Failed),
            "lost" => Ok(Self::Lost),
            _ => Err(RuntimeError::internal(format!("unknown job status: {s}"))),
        }
    }
}

#[derive(Debug, Clone)]
struct Job {
    id: String,
    script_path: String,
    output_path: String,
    cwd: String,
    cols: i32,
    rows: i32,
    status: Status,
    session_name: String,
    pane_target: String,
    exit_code: Option<i32>,
    _reason: Option<String>,
    _message: Option<String>,
    created_at: String,
    started_at: Option<String>,
    ended_at: Option<String>,
    _updated_at: String,
}

#[derive(Debug)]
pub struct RuntimeError {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl RuntimeError {
    fn new(status: u16, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
        }
    }
    fn not_found() -> Self {
        Self::new(404, "job_not_found", "Unknown job id")
    }
    fn internal(message: impl Into<String>) -> Self {
        Self::new(500, "internal_error", message)
    }
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}: {}", self.status, self.code, self.message)
    }
}
impl std::error::Error for RuntimeError {}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}
#[derive(Debug, Serialize)]
struct ErrorDetail {
    code: String,
    message: String,
}

impl IntoResponse for RuntimeError {
    fn into_response(self) -> Response {
        (
            StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            Json(ErrorBody {
                error: ErrorDetail {
                    code: self.code,
                    message: self.message,
                },
            }),
        )
            .into_response()
    }
}

#[derive(Debug, Deserialize)]
pub struct RunJobRequest {
    pub script: String,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub terminal: Option<TerminalSize>,
    pub timeout: Option<f64>,
    pub output_limit: Option<usize>,
    pub idle_flush_seconds: Option<f64>,
}
#[derive(Debug, Deserialize)]
pub struct TerminalSize {
    pub cols: i32,
    pub rows: i32,
}
#[derive(Debug, Deserialize)]
pub struct WaitJobRequest {
    pub timeout: f64,
    pub offset: usize,
    pub output_limit: Option<usize>,
    pub idle_flush_seconds: Option<f64>,
}
#[derive(Debug, Deserialize)]
pub struct InputJobRequest {
    pub text: String,
    pub timeout: Option<f64>,
    pub offset: usize,
    pub output_limit: Option<usize>,
    pub idle_flush_seconds: Option<f64>,
}
#[derive(Debug, Deserialize)]
pub struct TerminateJobRequest {
    pub grace_seconds: Option<f64>,
}
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub status: Option<String>,
    pub limit: Option<usize>,
}
#[derive(Debug, Deserialize)]
pub struct TailQuery {
    pub output_limit: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct JobResult {
    pub job_id: String,
    pub done: bool,
    pub status: Status,
    pub exit_code: Option<i32>,
    pub output_path: String,
    pub output: String,
    pub offset: usize,
    pub truncated: bool,
}
#[derive(Debug, Serialize)]
pub struct JobStatusView {
    pub job_id: String,
    pub status: Status,
    pub done: bool,
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub offset: usize,
}
#[derive(Debug, Serialize)]
pub struct JobInfo {
    pub job_id: String,
    pub status: Status,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct ListJobsResponse {
    pub jobs: Vec<JobInfo>,
}
#[derive(Debug, Serialize)]
pub struct DeleteJobResponse {
    pub job_id: String,
    pub deleted: bool,
}
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
fn job_id() -> String {
    let mut bytes = [0_u8; 8];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn session_name(id: &str) -> String {
    format!("shellctl-{id}")
}
fn pane_target(id: &str) -> String {
    format!("{}:0.0", session_name(id))
}

fn db_open(path: &FsPath, busy_timeout_ms: u64) -> Result<Connection, RuntimeError> {
    let conn = db_connect(path, busy_timeout_ms, true)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS jobs (job_id TEXT PRIMARY KEY, script_path TEXT NOT NULL, output_path TEXT NOT NULL, cwd TEXT NOT NULL, terminal_cols INTEGER NOT NULL DEFAULT 200, terminal_rows INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'created', session_name TEXT NOT NULL, pane_target TEXT NOT NULL, exit_code INTEGER, reason TEXT, message TEXT, created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT, updated_at TEXT NOT NULL);")
        .map_err(|e| RuntimeError::internal(format!("init sqlite schema: {e}")))?;
    Ok(conn)
}

// Runner-exit is intentionally a short-lived helper. The server owns schema
// creation, so reopening a known database must not pay for DDL on every job.
fn db_connect(
    path: &FsPath,
    busy_timeout_ms: u64,
    ensure_wal: bool,
) -> Result<Connection, RuntimeError> {
    let conn =
        Connection::open(path).map_err(|e| RuntimeError::internal(format!("open sqlite: {e}")))?;
    conn.busy_timeout(Duration::from_millis(busy_timeout_ms))
        .map_err(|e| RuntimeError::internal(e.to_string()))?;
    if ensure_wal {
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| RuntimeError::internal(e.to_string()))?;
    }
    Ok(conn)
}

fn read_job(conn: &Connection, id: &str) -> Result<Job, RuntimeError> {
    conn.query_row("SELECT job_id,script_path,output_path,cwd,terminal_cols,terminal_rows,status,session_name,pane_target,exit_code,reason,message,created_at,started_at,ended_at,updated_at FROM jobs WHERE job_id=?1", [id], |r| {
        let status: String = r.get(6)?;
        Ok(Job { id: r.get(0)?, script_path: r.get(1)?, output_path: r.get(2)?, cwd: r.get(3)?, cols: r.get(4)?, rows: r.get(5)?, status: Status::try_from(status.as_str()).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?, session_name: r.get(7)?, pane_target: r.get(8)?, exit_code: r.get(9)?, _reason: r.get(10)?, _message: r.get(11)?, created_at: r.get(12)?, started_at: r.get(13)?, ended_at: r.get(14)?, _updated_at: r.get(15)? })
    }).optional().map_err(|e| RuntimeError::internal(format!("query job: {e}")))?.ok_or_else(RuntimeError::not_found)
}

fn transition(
    conn: &Connection,
    id: &str,
    target: Status,
    allowed: &[Status],
    reason: Option<&str>,
    message: Option<&str>,
    ended_at: Option<&str>,
) -> Result<Job, RuntimeError> {
    let now = timestamp();
    let marks = std::iter::repeat_n("?", allowed.len())
        .collect::<Vec<_>>()
        .join(",");
    let mut sql = "UPDATE jobs SET status=?1, updated_at=?2, reason=?3, message=?4".to_string();
    let mut values: Vec<String> = vec![
        target.as_str().into(),
        now.clone(),
        reason.unwrap_or("").into(),
        message.unwrap_or("").into(),
    ];
    let mut next = 5;
    if matches!(target, Status::Starting | Status::Running) {
        sql.push_str(&format!(", started_at=COALESCE(started_at, ?{next})"));
        values.push(now.clone());
        next += 1;
    }
    if target.terminal() {
        sql.push_str(&format!(
            ", ended_at=COALESCE(ended_at, ?{next}), exit_code=COALESCE(exit_code, 0)"
        ));
        values.push(ended_at.unwrap_or(&now).into());
        next += 1;
    }
    sql.push_str(&format!(" WHERE job_id=?{next} AND status IN ({marks})"));
    values.push(id.into());
    values.extend(allowed.iter().map(|s| s.as_str().into()));
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| RuntimeError::internal(format!("prepare transition: {e}")))?;
    let mut params: Vec<&dyn rusqlite::ToSql> =
        values.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    stmt.execute(rusqlite::params_from_iter(params.drain(..)))
        .map_err(|e| RuntimeError::internal(format!("transition status: {e}")))?;
    read_job(conn, id)
}

fn db_record_runner_exit(
    conn: &Connection,
    id: &str,
    code: i32,
    ended_at: &str,
) -> Result<(), RuntimeError> {
    let n = conn.execute("UPDATE jobs SET status='exited', exit_code=?1, ended_at=?2, updated_at=?2, reason=NULL, message=NULL WHERE job_id=?3 AND status IN ('created','starting','running')", params![code, ended_at, id]).map_err(|e| RuntimeError::internal(format!("update job: {e}")))?;
    if n > 0 {
        return Ok(());
    }
    // A zero-row CAS is expected for an already-terminal job, but must still
    // report a genuinely unknown id just like the Go implementation.
    let exists: Option<i64> = conn
        .query_row("SELECT 1 FROM jobs WHERE job_id=?1", [id], |row| row.get(0))
        .optional()
        .map_err(|e| RuntimeError::internal(format!("query job existence: {e}")))?;
    exists.map(|_| ()).ok_or_else(RuntimeError::not_found)
}

#[derive(Debug, Serialize)]
pub struct OutputWindow {
    pub output: String,
    pub offset: usize,
    pub truncated: bool,
}
fn valid_prefix(data: &[u8], max: usize) -> usize {
    let end = max.min(data.len());
    (0..=end)
        .rev()
        .find(|i| std::str::from_utf8(&data[..*i]).is_ok())
        .unwrap_or(0)
}
fn read_window(path: &FsPath, offset: usize, limit: usize) -> Result<OutputWindow, RuntimeError> {
    let data = match fs::read(path) {
        Ok(v) => v,
        Err(e) if e.kind() == io::ErrorKind::NotFound && offset == 0 => {
            return Ok(OutputWindow {
                output: String::new(),
                offset: 0,
                truncated: false,
            });
        }
        Err(e) => return Err(RuntimeError::internal(e.to_string())),
    };
    if offset > data.len() {
        return Err(RuntimeError::new(
            400,
            "invalid_offset",
            format!("offset {offset} exceeds current file size {}", data.len()),
        ));
    }
    if offset == data.len() {
        return Ok(OutputWindow {
            output: String::new(),
            offset,
            truncated: false,
        });
    }
    let buf = &data[offset..(data.len()).min(offset + limit + 4)];
    let shift = buf
        .iter()
        .position(|b| (*b & 0xc0) != 0x80)
        .unwrap_or(buf.len());
    let payload = &buf[shift..];
    let mut consumed = valid_prefix(payload, limit.saturating_sub(shift));
    if consumed == 0 && !payload.is_empty() {
        consumed = payload
            .iter()
            .enumerate()
            .find_map(|(i, b)| {
                if i > 0 && (*b & 0xc0) != 0x80 {
                    Some(i)
                } else {
                    None
                }
            })
            .unwrap_or(payload.len())
            .min(4);
        while consumed > 0 && std::str::from_utf8(&payload[..consumed]).is_err() {
            consumed -= 1;
        }
    }
    let next = offset + shift + consumed;
    Ok(OutputWindow {
        output: String::from_utf8_lossy(&payload[..consumed]).into_owned(),
        offset: next,
        truncated: next < data.len(),
    })
}
fn tail_window(path: &FsPath, limit: usize) -> Result<OutputWindow, RuntimeError> {
    let data = match fs::read(path) {
        Ok(v) => v,
        Err(e) if e.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(RuntimeError::internal(e.to_string())),
    };
    if data.is_empty() {
        return Ok(OutputWindow {
            output: String::new(),
            offset: 0,
            truncated: false,
        });
    }
    let start = data.len().saturating_sub(limit);
    let mut pos = start;
    while pos < data.len() && (data[pos] & 0xc0) == 0x80 {
        pos += 1;
    }
    let payload = &data[pos..];
    let valid = valid_prefix(payload, payload.len());
    Ok(OutputWindow {
        output: String::from_utf8_lossy(&payload[..valid]).into_owned(),
        offset: pos + valid,
        truncated: false,
    })
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Runtime>,
}
pub struct Runtime {
    config: Config,
    db: Mutex<Connection>,
    starting: Mutex<HashSet<String>>,
}

impl Runtime {
    pub fn initialize(config: Config) -> Result<Arc<Self>, RuntimeError> {
        fs::create_dir_all(&config.state_dir)
            .map_err(|e| RuntimeError::internal(format!("create state dir: {e}")))?;
        fs::create_dir_all(&config.runtime_dir)
            .map_err(|e| RuntimeError::internal(format!("create runtime dir: {e}")))?;
        fs::create_dir_all(config.jobs_dir())
            .map_err(|e| RuntimeError::internal(format!("create jobs dir: {e}")))?;
        fs::create_dir_all(config.runner_path().parent().unwrap())
            .map_err(|e| RuntimeError::internal(format!("create runner dir: {e}")))?;
        let conn = db_open(&config.db_path(), config.sqlite_busy_timeout_ms)?;
        let runtime = Arc::new(Self {
            config: config.clone(),
            db: Mutex::new(conn),
            starting: Mutex::new(HashSet::new()),
        });
        runtime.install_runner();
        runtime.start_tmux_server()?;
        runtime.reconcile_startup()?;
        Ok(runtime)
    }

    /// Keep completion reconciliation inside the long-lived server process.
    ///
    /// The pipe still writes exit metadata atomically, so `wait` and `list`
    /// can reconcile immediately. This background pass covers jobs that have
    /// no active API caller without spawning one SQLite helper process per job.
    fn start_reconciler(runtime: Arc<Self>) {
        let interval = runtime
            .config
            .pipe_monitor_interval
            .max(Duration::from_millis(50));
        let _ = thread::Builder::new()
            .name("shellctl-reconciler".into())
            .spawn(move || {
                loop {
                    thread::sleep(interval);
                    let _ = runtime.reconcile_artifacts();
                }
            });
    }
    fn install_runner(&self) {
        let dst = self.config.runner_path();
        let _ = fs::remove_file(&dst);
        if let Ok(exe) = env::current_exe() {
            let candidate = exe
                .parent()
                .unwrap_or(FsPath::new("."))
                .join("shellctl-runner");
            if candidate.exists() {
                let _ = std::os::unix::fs::symlink(candidate, dst);
            }
        }
    }
    fn output_path(&self, job: &Job) -> PathBuf {
        self.config.state_dir.join(&job.output_path)
    }
    fn job_view(&self, job: &Job) -> JobStatusView {
        let offset = fs::metadata(self.output_path(job))
            .map(|m| m.len() as usize)
            .unwrap_or(0);
        JobStatusView {
            job_id: job.id.clone(),
            status: job.status,
            done: job.status.terminal(),
            exit_code: job.exit_code,
            created_at: job.created_at.clone(),
            started_at: job.started_at.clone(),
            ended_at: job.ended_at.clone(),
            offset,
        }
    }
    fn tmux(&self, args: &[&str]) -> Result<(i32, String, String), RuntimeError> {
        let mut cmd = Command::new("tmux");
        cmd.arg("-S").arg(self.config.tmux_socket());
        for a in args {
            cmd.arg(a);
        }
        cmd.env_remove("TMUX");
        let out = cmd
            .output()
            .map_err(|e| RuntimeError::internal(format!("exec tmux: {e}")))?;
        Ok((
            out.status.code().unwrap_or(125),
            String::from_utf8_lossy(&out.stdout).into_owned(),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ))
    }
    fn tmux_ok(&self, args: &[&str]) -> Result<(), RuntimeError> {
        let (code, _, err) = self.tmux(args)?;
        if code != 0 {
            return Err(RuntimeError::new(500, "tmux_error", err.trim().to_string()));
        }
        Ok(())
    }
    fn start_tmux_server(&self) -> Result<(), RuntimeError> {
        self.tmux_ok(&["start-server", ";", "set-option", "-g", "exit-empty", "off"])
    }
    fn session_exists(&self, id: &str) -> Result<bool, RuntimeError> {
        let (code, out, err) = self.tmux(&["list-sessions", "-F", "#{session_name}"])?;
        if code != 0 && !tmux_missing(&err) {
            return Err(RuntimeError::new(500, "tmux_error", err.trim()));
        }
        Ok(out.lines().any(|line| line.trim() == session_name(id)))
    }
    fn pipe_active(&self, id: &str) -> Result<Option<bool>, RuntimeError> {
        let (code, out, err) = self.tmux(&[
            "display-message",
            "-p",
            "-t",
            &pane_target(id),
            "#{pane_pipe}",
        ])?;
        if code != 0 {
            if tmux_missing(&err) {
                return Ok(None);
            }
            return Err(RuntimeError::new(500, "tmux_error", err.trim()));
        }
        Ok(Some(out.trim() == "1"))
    }
    fn live_view(&self, id: &str) -> Result<JobStatusView, RuntimeError> {
        let (session, pipe) = (self.session_exists(id)?, None);
        let pipe = if session { self.pipe_active(id)? } else { pipe };
        let pipe_failed = self
            .config
            .jobs_dir()
            .join(id)
            .join(".pipe-failed")
            .exists();
        let mut conn = self.db.lock().unwrap();
        let mut job = read_job(&conn, id)?;
        if !job.status.terminal()
            && let Some((code, ended_at)) = drained_exit_metadata(&self.config.jobs_dir().join(id))
        {
            let _ = db_record_runner_exit(&conn, id, code, &ended_at);
            job = read_job(&conn, id)?;
        }
        if let Some(next_job) = materialize(
            &mut conn,
            &job,
            session,
            pipe,
            pipe_failed,
            self.starting.lock().unwrap().contains(id),
        )? {
            job = next_job;
        }
        Ok(self.job_view(&job))
    }
    pub fn health() -> Json<HealthResponse> {
        Json(HealthResponse { status: "ok" })
    }
    pub fn run_job(&self, req: RunJobRequest) -> Result<JobResult, RuntimeError> {
        let cwd = req
            .cwd
            .map(PathBuf::from)
            .unwrap_or_else(|| self.config.default_cwd.clone());
        if !cwd.is_dir() {
            return Err(RuntimeError::new(
                400,
                "invalid_cwd",
                format!("cwd is not a directory: {}", cwd.display()),
            ));
        }
        let cwd = fs::canonicalize(cwd)
            .map_err(|e| RuntimeError::new(400, "invalid_cwd", e.to_string()))?;
        let cols = req
            .terminal
            .as_ref()
            .map(|x| x.cols)
            .unwrap_or(self.config.terminal_cols);
        let rows = req
            .terminal
            .as_ref()
            .map(|x| x.rows)
            .unwrap_or(self.config.terminal_rows);
        let created = timestamp();
        let (id, dir) = (0..20)
            .find_map(|_| {
                let id = job_id();
                let dir = self.config.jobs_dir().join(&id);
                fs::create_dir(&dir).ok().map(|_| (id, dir))
            })
            .ok_or_else(|| {
                RuntimeError::new(
                    500,
                    "job_id_collision",
                    "Failed to allocate a unique job id",
                )
            })?;
        self.starting.lock().unwrap().insert(id.clone());
        let script = dir.join("script");
        let output = dir.join("output.log");
        let env_file = dir.join(".job-env.json");
        let write_result = (|| -> Result<(), RuntimeError> {
            fs::write(&script, req.script.as_bytes())
                .map_err(|e| RuntimeError::internal(e.to_string()))?;
            fs::write(&output, []).map_err(|e| RuntimeError::internal(e.to_string()))?;
            fs::write(
                &env_file,
                serde_json::to_vec(&req.env.unwrap_or_default()).unwrap(),
            )
            .map_err(|e| RuntimeError::internal(e.to_string()))?;
            Ok(())
        })();
        if let Err(e) = write_result {
            let _ = fs::remove_dir_all(&dir);
            self.starting.lock().unwrap().remove(&id);
            return Err(e);
        }
        let job = Job {
            id: id.clone(),
            script_path: format!("jobs/{id}/script"),
            output_path: format!("jobs/{id}/output.log"),
            cwd: cwd.display().to_string(),
            cols,
            rows,
            status: Status::Created,
            session_name: session_name(&id),
            pane_target: pane_target(&id),
            exit_code: None,
            _reason: None,
            _message: None,
            created_at: created.clone(),
            started_at: None,
            ended_at: None,
            _updated_at: created,
        };
        let conn = self.db.lock().unwrap();
        conn.execute("INSERT INTO jobs (job_id,script_path,output_path,cwd,terminal_cols,terminal_rows,status,session_name,pane_target,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)", params![job.id,job.script_path,job.output_path,job.cwd,job.cols,job.rows,job.status.as_str(),job.session_name,job.pane_target,job.created_at]).map_err(|e| RuntimeError::internal(format!("insert job: {e}")))?;
        transition(
            &conn,
            &id,
            Status::Starting,
            &[Status::Created],
            None,
            None,
            None,
        )?;
        drop(conn);
        let start = self.start_tmux_job(&id, &dir, &cwd, cols, rows);
        self.starting.lock().unwrap().remove(&id);
        if let Err(e) = start {
            let conn = self.db.lock().unwrap();
            let _ = transition(
                &conn,
                &id,
                Status::Failed,
                &[Status::Created, Status::Starting, Status::Running],
                Some("start_failed"),
                Some(&e.to_string()),
                None,
            );
            self.kill_session(&id);
        }
        let timeout = req
            .timeout
            .filter(|timeout| *timeout > 0.0)
            .unwrap_or(self.config.default_timeout.as_secs_f64());
        self.wait_job(
            &id,
            WaitJobRequest {
                timeout,
                offset: 0,
                output_limit: req.output_limit,
                idle_flush_seconds: req.idle_flush_seconds,
            },
        )
    }
    fn start_tmux_job(
        &self,
        id: &str,
        dir: &FsPath,
        cwd: &FsPath,
        cols: i32,
        rows: i32,
    ) -> Result<(), RuntimeError> {
        // The dedicated server is initialized once with exit-empty disabled,
        // matching the current Go runtime and avoiding per-job bootstrap.
        let runner = self.config.runner_path().to_string_lossy().into_owned();
        let d = dir.to_string_lossy().into_owned();
        let c = cwd.to_string_lossy().into_owned();
        let ready = dir.join(".pipe-ready");
        let output = shell_quote(&dir.join("output.log").to_string_lossy());
        let sanitizer = env::var("SHELLCTL_SANITIZE_COMMAND")
            .unwrap_or_else(|_| "shellctl-sanitize-pty".into());
        let error_log = shell_quote(&dir.join("pipe-error.log").to_string_lossy());
        let drained = shell_quote(&dir.join(".pipe-drained").to_string_lossy());
        let failed = shell_quote(&dir.join(".pipe-failed").to_string_lossy());
        let pipe = format!(
            "{} --ready-file {} >> {} 2> {}; sanitize_status=$?; if [ \"$sanitize_status\" -eq 0 ]; then : > {}; else : > {}; fi; exit \"$sanitize_status\"",
            shell_quote(&sanitizer),
            shell_quote(&ready.to_string_lossy()),
            output,
            error_log,
            drained,
            failed,
        );
        let session = session_name(id);
        let pane = pane_target(id);
        let runner_command = format!(
            "{} {} {} {}",
            shell_quote(&runner),
            shell_quote(&d),
            shell_quote(id),
            shell_quote(&c)
        );
        let cols = cols.to_string();
        let rows = rows.to_string();
        let tmux_args = [
            "-f",
            "/dev/null",
            "new-session",
            "-d",
            "-s",
            &session,
            "-x",
            &cols,
            "-y",
            &rows,
            &runner_command,
            ";",
            "pipe-pane",
            "-o",
            "-t",
            &pane,
            &pipe,
        ];
        let started = self.tmux(&tmux_args)?;
        if started.0 != 0 {
            return Err(RuntimeError::new(
                500,
                "tmux_new_session_failed",
                started.2.trim(),
            ));
        }
        let deadline = Instant::now() + self.config.pipe_ready_timeout;
        while Instant::now() < deadline {
            if ready.exists() && self.pipe_active(id)?.unwrap_or(false) {
                let _ = fs::write(dir.join("start-gate"), []);
                let conn = self.db.lock().unwrap();
                transition(
                    &conn,
                    id,
                    Status::Running,
                    &[Status::Starting],
                    None,
                    None,
                    None,
                )?;
                return Ok(());
            }
            thread::sleep(PIPE_READY_POLL_INTERVAL);
        }
        Err(RuntimeError::new(
            500,
            "pipe_failed",
            "timed out waiting for pipe ready",
        ))
    }
    fn wait_job(&self, id: &str, req: WaitJobRequest) -> Result<JobResult, RuntimeError> {
        let job = {
            let conn = self.db.lock().unwrap();
            read_job(&conn, id)?
        };
        let path = self.output_path(&job);
        let limit = req
            .output_limit
            .unwrap_or(self.config.default_output_limit)
            .min(self.config.max_output_limit);
        let timeout = if req.timeout > 0.0 {
            Duration::from_secs_f64(req.timeout.min(self.config.max_wait_timeout.as_secs_f64()))
        } else {
            Duration::ZERO
        };
        let idle = Duration::from_secs_f64(
            req.idle_flush_seconds
                .unwrap_or(DEFAULT_IDLE_FLUSH)
                .max(0.0),
        );
        let deadline = Instant::now() + timeout;
        let mut last_size = file_size(&path);
        let mut saw = last_size > req.offset;
        let mut growth = if saw { Some(Instant::now()) } else { None };
        // The caller already materialized this row and start_tmux_job only
        // returns after the session and output pipe are live. Fast jobs can
        // therefore complete via their atomic exit artifacts without two
        // extra tmux CLI probes on every request.
        let mut view = self.job_view(&job);
        let mut next_runtime_probe = Instant::now() + POLL_INTERVAL;
        let mut next_output_probe = Instant::now();
        loop {
            if view.done {
                let w = read_window(&path, req.offset, limit)?;
                return Ok(self.result(&view, &job, w));
            }
            if let Some((code, ended_at)) = drained_exit_metadata(&self.config.jobs_dir().join(id))
            {
                let conn = self.db.lock().unwrap();
                let _ = db_record_runner_exit(&conn, id, code, &ended_at);
                let job_view = read_job(&conn, id)?;
                view = self.job_view(&job_view);
            } else if Instant::now() >= next_runtime_probe {
                next_runtime_probe = Instant::now() + POLL_INTERVAL;
                view = self.live_view(id)?;
            }
            if view.done {
                let w = read_window(&path, req.offset, limit)?;
                return Ok(self.result(&view, &job, w));
            }
            if Instant::now() >= next_output_probe {
                next_output_probe = Instant::now() + OUTPUT_WAIT_INTERVAL;
                let size = file_size(&path);
                if size > last_size {
                    last_size = size;
                    if size > req.offset {
                        saw = true;
                        growth = Some(Instant::now());
                    }
                }
                if size > req.offset {
                    let w = read_window(&path, req.offset, limit)?;
                    if w.truncated || (saw && growth.is_some_and(|t| t.elapsed() >= idle)) {
                        return Ok(self.result(&view, &job, w));
                    }
                }
            }
            if Instant::now() >= deadline {
                let size = file_size(&path);
                let w = if size > req.offset {
                    read_window(&path, req.offset, limit)?
                } else {
                    OutputWindow {
                        output: String::new(),
                        offset: req.offset,
                        truncated: false,
                    }
                };
                return Ok(self.result(&view, &job, w));
            }
            thread::sleep(OUTPUT_WAIT_INTERVAL);
        }
    }
    fn result(&self, view: &JobStatusView, job: &Job, w: OutputWindow) -> JobResult {
        JobResult {
            job_id: view.job_id.clone(),
            done: view.done,
            status: view.status,
            exit_code: view.exit_code,
            output_path: fs::canonicalize(self.output_path(job))
                .unwrap_or_else(|_| self.output_path(job))
                .display()
                .to_string(),
            output: w.output,
            offset: w.offset,
            truncated: w.truncated,
        }
    }
    fn send_input(&self, id: &str, req: InputJobRequest) -> Result<JobResult, RuntimeError> {
        let view = self.live_view(id)?;
        if view.done {
            return Err(RuntimeError::new(
                409,
                "job_not_running",
                format!("Job {id} is already terminal"),
            ));
        }
        let file = self.config.runtime_dir.join(format!("input-{id}"));
        fs::write(&file, req.text).map_err(|e| RuntimeError::internal(e.to_string()))?;
        let buf = format!("shellctl-in-{id}");
        let fp = file.to_string_lossy().into_owned();
        let load = self.tmux(&["load-buffer", "-b", &buf, &fp])?;
        let _ = fs::remove_file(&file);
        if load.0 != 0 {
            return Err(RuntimeError::new(409, "tmux_target_missing", load.2.trim()));
        }
        let pasted = self.tmux(&["paste-buffer", "-t", &pane_target(id), "-b", &buf]);
        let _ = self.tmux(&["delete-buffer", "-b", &buf]);
        if let Err(e) = pasted {
            return Err(e);
        }
        if pasted.unwrap().0 != 0 {
            return Err(RuntimeError::new(
                409,
                "tmux_target_missing",
                "tmux target missing",
            ));
        }
        self.wait_job(
            id,
            WaitJobRequest {
                timeout: req.timeout.unwrap_or(30.0),
                offset: req.offset,
                output_limit: req.output_limit,
                idle_flush_seconds: req.idle_flush_seconds,
            },
        )
    }
    fn kill_session(&self, id: &str) {
        let _ = self.tmux(&["kill-session", "-t", &session_name(id)]);
    }
    fn terminate(&self, id: &str, grace: f64) -> Result<JobStatusView, RuntimeError> {
        let view = self.live_view(id)?;
        if view.done {
            self.kill_session(id);
            return Ok(view);
        }
        {
            let c = self.db.lock().unwrap();
            let _ = transition(
                &c,
                id,
                Status::Terminated,
                &[
                    Status::Created,
                    Status::Starting,
                    Status::Running,
                    Status::Exited,
                ],
                None,
                None,
                None,
            );
        }
        let _ = self.tmux(&["send-keys", "-t", &pane_target(id), "C-c"]);
        if grace > 0.0 {
            thread::sleep(Duration::from_secs_f64(grace));
        }
        self.kill_session(id);
        self.live_view(id)
    }
    fn delete(&self, id: &str, force: bool, grace: f64) -> Result<DeleteJobResponse, RuntimeError> {
        let v = self.live_view(id)?;
        if !v.done && !force {
            return Err(RuntimeError::new(
                409,
                "job_running",
                format!("Job {id} is still running"),
            ));
        }
        if !v.done {
            let _ = self.terminate(id, grace);
        }
        self.kill_session(id);
        let c = self.db.lock().unwrap();
        let n = c
            .execute("DELETE FROM jobs WHERE job_id=?1", [id])
            .map_err(|e| RuntimeError::internal(e.to_string()))?;
        if n == 0 {
            return Err(RuntimeError::not_found());
        }
        let _ = fs::remove_dir_all(self.config.jobs_dir().join(id));
        Ok(DeleteJobResponse {
            job_id: id.into(),
            deleted: true,
        })
    }
    fn reconcile_startup(&self) -> Result<(), RuntimeError> {
        let ids = self.list_ids()?;
        for id in ids {
            if let Ok(v) = self.live_view(&id)
                && v.done
            {
                self.kill_session(&id);
            }
        }
        Ok(())
    }
    fn reconcile_artifacts(&self) -> Result<(), RuntimeError> {
        let ids = self.list_nonterminal_ids()?;
        for id in ids {
            let dir = self.config.jobs_dir().join(&id);
            if let Some((code, ended_at)) = drained_exit_metadata(&dir) {
                let conn = self.db.lock().unwrap();
                let _ = db_record_runner_exit(&conn, &id, code, &ended_at);
                drop(conn);
                self.kill_session(&id);
            } else if dir.join(".pipe-failed").exists() {
                let conn = self.db.lock().unwrap();
                let _ = transition(
                    &conn,
                    &id,
                    Status::Failed,
                    &[Status::Created, Status::Starting, Status::Running],
                    Some("pipe_failed"),
                    Some("The tmux output pipe failed before completion."),
                    None,
                );
                drop(conn);
                self.kill_session(&id);
            }
        }
        Ok(())
    }
    fn list_nonterminal_ids(&self) -> Result<Vec<String>, RuntimeError> {
        let c = self.db.lock().unwrap();
        let mut s = c
            .prepare("SELECT job_id FROM jobs WHERE status IN ('created','starting','running') ORDER BY created_at DESC")
            .map_err(|e| RuntimeError::internal(e.to_string()))?;
        let it = s
            .query_map([], |r| r.get(0))
            .map_err(|e| RuntimeError::internal(e.to_string()))?;
        Ok(it.filter_map(Result::ok).collect())
    }
    fn list_ids(&self) -> Result<Vec<String>, RuntimeError> {
        let c = self.db.lock().unwrap();
        let mut s = c
            .prepare("SELECT job_id FROM jobs ORDER BY created_at DESC")
            .map_err(|e| RuntimeError::internal(e.to_string()))?;
        let it = s
            .query_map([], |r| r.get(0))
            .map_err(|e| RuntimeError::internal(e.to_string()))?;
        Ok(it.filter_map(Result::ok).collect())
    }
    fn list(&self, q: ListQuery) -> Result<ListJobsResponse, RuntimeError> {
        let mut out = Vec::new();
        for id in self.list_ids()? {
            let v = self.live_view(&id)?;
            if q.status.as_deref().is_some_and(|s| s != v.status.as_str()) {
                continue;
            }
            out.push(JobInfo {
                job_id: v.job_id,
                status: v.status,
                created_at: v.created_at,
                started_at: v.started_at,
                ended_at: v.ended_at,
            });
            if out.len() >= q.limit.unwrap_or(50).min(200) {
                break;
            }
        }
        Ok(ListJobsResponse { jobs: out })
    }
}

fn materialize(
    conn: &mut Connection,
    job: &Job,
    session: bool,
    pipe: Option<bool>,
    pipe_failed: bool,
    starting: bool,
) -> Result<Option<Job>, RuntimeError> {
    if job.status.terminal() {
        return Ok(None);
    }
    if job.exit_code.is_some() {
        return Ok(transition(
            conn,
            &job.id,
            Status::Exited,
            &[Status::Created, Status::Starting, Status::Running],
            None,
            None,
            None,
        )
        .ok());
    } else if !session && !starting {
        return Ok(transition(
            conn,
            &job.id,
            Status::Lost,
            &[Status::Created, Status::Starting, Status::Running],
            Some("tmux_session_missing"),
            Some("The dedicated tmux session is no longer present."),
            None,
        )
        .ok());
    } else if session && pipe == Some(false) && pipe_failed && !starting {
        return Ok(transition(
            conn,
            &job.id,
            Status::Failed,
            &[Status::Created, Status::Starting, Status::Running],
            Some("pipe_failed"),
            Some("The tmux output pipe stopped while the job was still running."),
            None,
        )
        .ok());
    } else if session && matches!(job.status, Status::Created | Status::Starting) && !starting {
        return Ok(transition(
            conn,
            &job.id,
            Status::Running,
            &[Status::Created, Status::Starting],
            None,
            None,
            None,
        )
        .ok());
    }
    Ok(None)
}
fn file_size(p: &FsPath) -> usize {
    fs::metadata(p).map(|m| m.len() as usize).unwrap_or(0)
}
fn drained_exit_metadata(dir: &FsPath) -> Option<(i32, String)> {
    exit_metadata(dir, ".pipe-drained")
}
fn exit_metadata(dir: &FsPath, marker: &str) -> Option<(i32, String)> {
    if !dir.join(marker).exists() {
        return None;
    }
    let code = fs::read_to_string(dir.join("runner-exit-code"))
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let ended = fs::read_to_string(dir.join("runner-ended-at"))
        .ok()?
        .trim()
        .to_string();
    if ended.is_empty() {
        None
    } else {
        Some((code, ended))
    }
}
fn tmux_missing(s: &str) -> bool {
    let s = s.to_ascii_lowercase();
    [
        "can't find pane",
        "can't find session",
        "no server running",
        "failed to connect",
        "server exited unexpectedly",
    ]
    .iter()
    .any(|x| s.contains(x))
}
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub fn router(state: Arc<Runtime>) -> Router {
    let auth = state.config.auth_token.clone();
    Router::new()
        .route("/healthz", get(health_handler))
        .route("/v1/jobs/run", post(run_handler))
        .route("/v1/jobs", get(list_handler))
        .route(
            "/v1/jobs/{job_id}",
            get(status_handler).delete(delete_handler),
        )
        .route("/v1/jobs/{job_id}/wait", post(wait_handler))
        .route("/v1/jobs/{job_id}/log/tail", get(tail_handler))
        .route("/v1/jobs/{job_id}/input", post(input_handler))
        .route("/v1/jobs/{job_id}/terminate", post(terminate_handler))
        .with_state(AppState { inner: state })
        .layer(middleware::from_fn(
            move |req: Request<Body>, next: Next| {
                let token = auth.clone();
                async move {
                    if req.uri().path() == "/healthz" || token.is_empty() {
                        return next.run(req).await;
                    }
                    if req
                        .headers()
                        .get("authorization")
                        .and_then(|x| x.to_str().ok())
                        != Some(&format!("Bearer {token}"))
                    {
                        return RuntimeError::new(
                            401,
                            "unauthorized",
                            "Missing or invalid bearer token",
                        )
                        .into_response();
                    }
                    next.run(req).await
                }
            },
        ))
}
async fn health_handler() -> Json<HealthResponse> {
    Runtime::health()
}
async fn run_handler(
    State(s): State<AppState>,
    Json(req): Json<RunJobRequest>,
) -> Result<Json<JobResult>, RuntimeError> {
    if req.script.is_empty() {
        return Err(RuntimeError::new(
            400,
            "invalid_request",
            "script is required",
        ));
    }
    if let Some(e) = &req.env {
        for (k, v) in e {
            if k.is_empty() {
                return Err(RuntimeError::new(
                    422,
                    "validation_error",
                    "env names must be non-empty",
                ));
            }
            if k.contains('=') || k.contains('\0') || v.contains('\0') {
                return Err(RuntimeError::new(
                    422,
                    "validation_error",
                    "env entries must not contain NUL or '='",
                ));
            }
        }
    }
    let r = s.inner.clone();
    tokio::task::spawn_blocking(move || r.run_job(req))
        .await
        .map_err(|e| RuntimeError::internal(e.to_string()))?
        .map(Json)
}
async fn wait_handler(
    Path(id): Path<String>,
    State(s): State<AppState>,
    Json(mut req): Json<WaitJobRequest>,
) -> Result<Json<JobResult>, RuntimeError> {
    if req.idle_flush_seconds == Some(0.0) {
        req.idle_flush_seconds = Some(DEFAULT_IDLE_FLUSH);
    }
    let r = s.inner.clone();
    tokio::task::spawn_blocking(move || r.wait_job(&id, req))
        .await
        .map_err(|e| RuntimeError::internal(e.to_string()))?
        .map(Json)
}
async fn tail_handler(
    Path(id): Path<String>,
    State(s): State<AppState>,
    Query(q): Query<TailQuery>,
) -> Result<Json<JobResult>, RuntimeError> {
    let r = s.inner.clone();
    tokio::task::spawn_blocking(move || {
        let j = {
            let c = r.db.lock().unwrap();
            read_job(&c, &id)?
        };
        let v = r.live_view(&id)?;
        let w = tail_window(
            &r.output_path(&j),
            q.output_limit
                .unwrap_or(r.config.default_output_limit)
                .min(r.config.max_output_limit),
        )?;
        Ok(Json(r.result(&v, &j, w)))
    })
    .await
    .map_err(|e| RuntimeError::internal(e.to_string()))?
}
async fn status_handler(
    Path(id): Path<String>,
    State(s): State<AppState>,
) -> Result<Json<JobStatusView>, RuntimeError> {
    let r = s.inner.clone();
    tokio::task::spawn_blocking(move || r.live_view(&id))
        .await
        .map_err(|e| RuntimeError::internal(e.to_string()))?
        .map(Json)
}
async fn list_handler(
    State(s): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<ListJobsResponse>, RuntimeError> {
    let r = s.inner.clone();
    tokio::task::spawn_blocking(move || r.list(q))
        .await
        .map_err(|e| RuntimeError::internal(e.to_string()))?
        .map(Json)
}
async fn input_handler(
    Path(id): Path<String>,
    State(s): State<AppState>,
    Json(req): Json<InputJobRequest>,
) -> Result<Json<JobResult>, RuntimeError> {
    let r = s.inner.clone();
    tokio::task::spawn_blocking(move || r.send_input(&id, req))
        .await
        .map_err(|e| RuntimeError::internal(e.to_string()))?
        .map(Json)
}
async fn terminate_handler(
    Path(id): Path<String>,
    State(s): State<AppState>,
    Json(req): Json<TerminateJobRequest>,
) -> Result<Json<JobStatusView>, RuntimeError> {
    let r = s.inner.clone();
    tokio::task::spawn_blocking(move || {
        r.terminate(&id, req.grace_seconds.unwrap_or(r.config.terminate_grace))
    })
    .await
    .map_err(|e| RuntimeError::internal(e.to_string()))?
    .map(Json)
}
async fn delete_handler(
    Path(id): Path<String>,
    State(s): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<DeleteJobResponse>, RuntimeError> {
    let r = s.inner.clone();
    let force = q.get("force").is_some_and(|v| v == "true");
    let grace = q
        .get("grace_seconds")
        .and_then(|v| v.parse().ok())
        .unwrap_or(r.config.terminate_grace);
    tokio::task::spawn_blocking(move || r.delete(&id, force, grace))
        .await
        .map_err(|e| RuntimeError::internal(e.to_string()))?
        .map(Json)
}

pub fn sanitize_bytes(input: &[u8]) -> Vec<u8> {
    let mut p = PtySanitizer::default();
    let mut out = p.feed(input);
    out.extend(p.flush());
    out
}
#[derive(Default)]
pub struct PtySanitizer {
    line: Vec<u8>,
    pending_cr: bool,
    state: SanitizeState,
}
#[derive(Default, PartialEq)]
enum SanitizeState {
    #[default]
    Normal,
    Esc,
    Csi,
    Osc,
    OscEsc,
}
impl PtySanitizer {
    fn feed(&mut self, input: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(input.len());
        self.feed_into(input, &mut out);
        out
    }
    fn feed_into(&mut self, input: &[u8], out: &mut Vec<u8>) {
        for &b in input {
            match self.state {
                SanitizeState::Normal => match b {
                    0x1b => self.state = SanitizeState::Esc,
                    b'\r' => self.pending_cr = true,
                    b'\n' => {
                        self.pending_cr = false;
                        out.extend_from_slice(String::from_utf8_lossy(&self.line).as_bytes());
                        out.push(b'\n');
                        self.line.clear()
                    }
                    _ => {
                        if self.pending_cr {
                            self.line.clear();
                        }
                        self.pending_cr = false;
                        self.line.push(b)
                    }
                },
                SanitizeState::Esc => {
                    self.state = match b {
                        b'[' => SanitizeState::Csi,
                        b']' => SanitizeState::Osc,
                        _ => SanitizeState::Normal,
                    };
                }
                SanitizeState::Csi => {
                    if (0x40..=0x7e).contains(&b) {
                        self.state = SanitizeState::Normal;
                    }
                }
                SanitizeState::Osc => {
                    if b == 7 {
                        self.state = SanitizeState::Normal
                    } else if b == 0x1b {
                        self.state = SanitizeState::OscEsc
                    }
                }
                SanitizeState::OscEsc => {
                    self.state = if b == b'\\' {
                        SanitizeState::Normal
                    } else {
                        SanitizeState::Osc
                    };
                }
            }
        }
    }
    fn flush(&mut self) -> Vec<u8> {
        self.pending_cr = false;
        let o = self.line.clone();
        self.line.clear();
        String::from_utf8_lossy(&o).into_owned().into_bytes()
    }
}

pub fn run_sanitizer(ready: Option<&FsPath>) -> io::Result<()> {
    if let Some(p) = ready {
        File::create(p)?;
    }
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    let mut s = PtySanitizer::default();
    let mut buf = [0u8; 8192];
    let mut sanitized = Vec::with_capacity(buf.len());
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        sanitized.clear();
        s.feed_into(&buf[..n], &mut sanitized);
        output.write_all(&sanitized)?;
    }
    output.write_all(&s.flush())?;
    output.flush()
}

pub fn run_runner(args: &[String]) -> i32 {
    if args.first().is_some_and(|a| a == "--exec") {
        return child_mode(&args[1..]);
    }
    if args.len() < 3 {
        eprintln!("usage: shellctl-runner <job_dir> <job_id> <cwd>");
        return 125;
    }
    let dir = FsPath::new(&args[0]);
    while !dir.join("start-gate").exists() {
        // The server opens this only after the output pipe is ready. A short
        // wait avoids adding a full runtime polling interval to every job.
        thread::sleep(START_GATE_POLL_INTERVAL);
    }
    let env_file = dir.join(".job-env.json");
    let overlay: HashMap<String, String> = fs::read(&env_file)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let mut cmd = Command::new(env::current_exe().unwrap());
    let isolation = env::var("SHELLCTL_ENABLE_PATH_ISOLATION")
        .map(|v| v == "true")
        .unwrap_or(true);
    let mut child_args = vec!["--exec".to_string()];
    if isolation {
        child_args.push("--landlock".into());
    }
    child_args.extend([dir.join("script").display().to_string(), args[2].clone()]);
    let mut child_env: HashMap<OsString, OsString> = env::vars_os()
        .filter(|(k, _)| {
            !matches!(
                k.to_str(),
                Some("TMUX")
                    | Some("SHELLCTL_STATE_DIR")
                    | Some("SHELLCTL_RUNTIME_DIR")
                    | Some("SHELLCTL_TMUX_SOCKET")
                    | Some("SHELLCTL_RUNNER")
                    | Some("SHELLCTL_AUTH_TOKEN")
            )
        })
        .collect();
    for (key, value) in overlay {
        child_env.insert(OsString::from(key), OsString::from(value));
    }
    let home = child_env
        .get(OsStr::new("HOME"))
        .cloned()
        .unwrap_or_default();
    if !home.is_empty() {
        let _ = fs::create_dir_all(&home);
    }
    let tmp = FsPath::new(&args[2]).join(".tmp");
    let _ = fs::create_dir_all(&tmp);
    for key in ["TMPDIR", "TMP", "TEMP"] {
        child_env
            .entry(key.into())
            .or_insert_with(|| tmp.display().to_string().into());
    }
    cmd.args(child_args)
        .current_dir(&args[2])
        .env_clear()
        .envs(child_env)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    let status = cmd.status();
    let code = status.ok().and_then(|s| s.code()).unwrap_or(125);
    let _ = atomic_write(&dir.join("runner-exit-code"), &code.to_string());
    let _ = atomic_write(&dir.join("runner-ended-at"), &timestamp());
    code
}
fn child_mode(args: &[String]) -> i32 {
    let mut i = 0;
    let landlock = args.first().is_some_and(|x| x == "--landlock");
    if landlock {
        i += 1;
    }
    if args.len() < i + 2 {
        return 125;
    }
    let script = &args[i];
    let cwd = &args[i + 1];
    if env::set_current_dir(cwd).is_err() {
        return 111;
    }
    let has_shebang = File::open(script)
        .and_then(|mut file| {
            let mut head = [0_u8; 2];
            file.read_exact(&mut head).map(|_| head)
        })
        .is_ok_and(|head| head == *b"#!");
    let mut command = if has_shebang {
        Command::new(script)
    } else {
        let mut c = Command::new("sh");
        c.arg(script);
        c
    };
    if landlock
        && let Err(e) = apply_landlock(
            &env::var("HOME").unwrap_or_default(),
            cwd,
            FsPath::new(script),
        )
    {
        eprintln!("shellctl-runner: WARNING: {e} — running without filesystem isolation");
    }
    let err = command.exec();
    eprintln!("shellctl-runner: exec failed: {err}");
    126
}
fn atomic_write(path: &FsPath, value: &str) -> io::Result<()> {
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    fs::write(&tmp, format!("{value}\n"))?;
    fs::rename(tmp, path)
}

#[cfg(target_os = "linux")]
fn apply_landlock(home: &str, cwd: &str, job: &FsPath) -> Result<(), Box<dyn std::error::Error>> {
    use landlock::{
        ABI, Access, AccessFs, PathBeneath, PathFd, Ruleset, RulesetAttr, RulesetCreatedAttr,
    };
    let abi = ABI::V1;
    let rw = AccessFs::from_all(abi);
    let ro = AccessFs::from_read(abi) | AccessFs::Execute;
    let mut rules = Ruleset::default()
        .handle_access(AccessFs::from_all(abi))?
        .create()?
        .no_new_privs(true);
    for p in [home, cwd]
        .into_iter()
        .filter(|p| !p.is_empty() && FsPath::new(p).exists())
    {
        rules = rules.add_rule(PathBeneath::new(PathFd::new(p)?, rw))?;
    }
    let job_path = job.to_string_lossy();
    for p in [
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/etc",
        "/proc",
        "/opt/dify-agent-tools",
        "/opt/homebrew",
        "/snap",
    ]
    .into_iter()
    .chain(std::iter::once(job_path.as_ref()))
    {
        if FsPath::new(p).exists() {
            rules = rules.add_rule(PathBeneath::new(PathFd::new(p)?, ro))?;
        }
    }
    for p in [
        "/dev/null",
        "/dev/zero",
        "/dev/urandom",
        "/dev/random",
        "/dev/tty",
    ] {
        if FsPath::new(p).exists() {
            rules = rules.add_rule(PathBeneath::new(
                PathFd::new(p)?,
                AccessFs::ReadFile | AccessFs::WriteFile,
            ))?;
        }
    }
    rules.restrict_self()?;
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn apply_landlock(
    _home: &str,
    _cwd: &str,
    _job: &FsPath,
) -> Result<(), Box<dyn std::error::Error>> {
    Err("Landlock is only available on Linux".into())
}

pub fn record_runner_exit(
    state_dir: &FsPath,
    id: &str,
    code: i32,
    ended_at: &str,
    busy: u64,
) -> Result<(), RuntimeError> {
    let c = db_connect(&state_dir.join("shellctl.db"), busy, false)?;
    db_record_runner_exit(&c, id, code, ended_at)
}

pub async fn serve(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let state = Runtime::initialize(config.clone())?;
    Runtime::start_reconciler(state.clone());
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(&config.listen).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn sanitizer_matches_runtime_contract() {
        assert_eq!(sanitize_bytes(b"hello\nworld\n"), b"hello\nworld\n");
        assert_eq!(sanitize_bytes(b"\x1b[31mred\x1b[0m\n"), b"red\n");
        assert_eq!(sanitize_bytes(b"50%\r100%\n"), b"100%\n");
        assert_eq!(sanitize_bytes(b"line1\r\nline2\r\n"), b"line1\nline2\n");
        assert_eq!(sanitize_bytes(b"\x1b]0;title\x07visible\n"), b"visible\n");
        assert_eq!(sanitize_bytes(b"no newline"), b"no newline");
        assert_eq!(
            sanitize_bytes(&[0xff, b'a', b'\n']),
            "\u{fffd}a\n".as_bytes()
        );
    }

    #[test]
    fn sanitizer_handles_sequences_split_across_chunks() {
        let mut s = PtySanitizer::default();
        assert!(s.feed(b"50%\r10").is_empty());
        assert_eq!(s.feed(b"0%\n"), b"100%\n");
        assert!(s.feed(b"\x1b[").is_empty());
        assert!(s.feed(b"31mred").is_empty());
        assert_eq!(s.feed(b"\n"), b"red\n");
    }

    #[test]
    fn output_windows_preserve_utf8_boundaries() {
        let path = std::env::temp_dir().join(format!("dify-runtime-test-{}", job_id()));
        let mut file = File::create(&path).unwrap();
        file.write_all("世界".as_bytes()).unwrap();
        drop(file);
        let window = read_window(&path, 0, 4).unwrap();
        assert_eq!(window.output, "世");
        assert_eq!(window.offset, 3);
        assert!(window.truncated);
        let tail = tail_window(&path, 4).unwrap();
        assert_eq!(tail.output, "界");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn sqlite_runner_exit_is_idempotent_for_terminal_jobs() {
        let dir = std::env::temp_dir().join(format!("dify-runtime-db-{}", job_id()));
        fs::create_dir_all(&dir).unwrap();
        let conn = db_open(&dir.join("shellctl.db"), 5000).unwrap();
        conn.execute("INSERT INTO jobs (job_id,script_path,output_path,cwd,status,session_name,pane_target,created_at,updated_at) VALUES ('job','script','out','/','running','s','s:0.0','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')", []).unwrap();
        db_record_runner_exit(&conn, "job", 7, "2026-01-01T00:00:01Z").unwrap();
        db_record_runner_exit(&conn, "job", 9, "2026-01-01T00:00:02Z").unwrap();
        let job = read_job(&conn, "job").unwrap();
        assert_eq!(job.status, Status::Exited);
        assert_eq!(job.exit_code, Some(7));
        let _ = fs::remove_dir_all(dir);
    }
}
