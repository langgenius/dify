use std::path::PathBuf;

fn main() {
    let mut state = None::<PathBuf>;
    let mut job = None::<String>;
    let mut code = 0_i32;
    let mut ended = None::<String>;
    let mut busy = 5000_u64;
    let a: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < a.len() {
        match a[i].as_str() {
            "--state-dir" => {
                i += 1;
                state = a.get(i).map(PathBuf::from)
            }
            "--job-id" => {
                i += 1;
                job = a.get(i).cloned()
            }
            "--exit-code" => {
                i += 1;
                code = a.get(i).and_then(|x| x.parse().ok()).unwrap_or(0)
            }
            "--ended-at" => {
                i += 1;
                ended = a.get(i).cloned()
            }
            "--sqlite-busy-timeout-ms" => {
                i += 1;
                busy = a.get(i).and_then(|x| x.parse().ok()).unwrap_or(5000)
            }
            x => {
                eprintln!("unknown flag: {x}");
                std::process::exit(2)
            }
        }
        i += 1;
    }
    let Some(state) = state else {
        eprintln!("--state-dir is required");
        std::process::exit(1)
    };
    let Some(job) = job else {
        eprintln!("--job-id is required");
        std::process::exit(1)
    };
    let Some(ended) = ended else {
        eprintln!("--ended-at is required");
        std::process::exit(1)
    };
    if let Err(e) = dify_agent_runtime::record_runner_exit(&state, &job, code, &ended, busy) {
        eprintln!("runner-exit: {e}");
        std::process::exit(1)
    }
}
